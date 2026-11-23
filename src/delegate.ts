import { realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { getAdapter } from "./adapters/index.js";
import type { EngineResult } from "./adapters/types.js";
import { parseCommand, runCommandIn } from "./check.js";
import { effectiveLinks, loadConfig, resolveTimeoutMinutes } from "./config.js";
import { buildEngineEnv } from "./env.js";
import { git } from "./git.js";
import { dataDir } from "./paths.js";
import { framePrompt } from "./prompt.js";
import { run } from "./runner.js";
import { createRunDir, writeMeta } from "./runs.js";
import { type DelegationOutcome, renderSummary } from "./summary.js";
import { changes, commitAll, createWorktree, newId } from "./worktree.js";

export interface DelegationInput {
  prompt: string;
  engine?: string;
  files?: string[];
  check?: string;
  timeoutMinutes?: number;
}

function outside(path: string): boolean {
  return isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`);
}

async function contextFiles(root: string, files: string[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const path = resolve(root, file);
      const name = relative(root, path);
      const outsideError = `context file is outside the repository: ${file}`;
      if (outside(name)) throw new Error(outsideError);
      const target = await realpath(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
          throw new Error(`context file does not exist: ${file}`);
        }
        throw error;
      });
      if (outside(relative(root, target))) throw new Error(outsideError);
      if (!(await stat(target)).isFile()) throw new Error(`context path is not a file: ${file}`);
      return name;
    }),
  );
}

export async function runDelegation(
  input: DelegationInput,
  {
    onProgress,
    env = process.env,
  }: { onProgress?: (elapsedMs: number) => void; env?: NodeJS.ProcessEnv } = {},
) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const timer = onProgress && setInterval(() => onProgress(Date.now() - started), 30_000);
  try {
    const root = await git(["rev-parse", "--show-toplevel"], {
      cwd: env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      allowFailure: true,
    });
    if (root.code !== 0) throw new Error("not inside a git repository");
    const repo = await realpath(root.stdout.replace(/\r?\n$/, ""));
    const { config } = loadConfig({ repoRoot: repo, env });
    const names = Object.keys(config.engines).sort();
    if (!names.length) {
      throw new Error("no engine configured: run /sideteam:setup or add one to .sideteam.json");
    }
    const engine = input.engine ?? config.default;
    if (engine === undefined) {
      throw new Error(
        `several engines are configured and none is the default: pass engine (one of: ${names.join(", ")}) or set default`,
      );
    }
    if (!Object.hasOwn(config.engines, engine)) {
      throw new Error(`unknown engine "${engine}": configured engines: ${names.join(", ")}`);
    }
    const cfg = config.engines[engine];
    const adapter = getAdapter(cfg.adapter);
    const command = input.check ?? config.check;
    if (command === undefined) {
      throw new Error("no check configured: pass check or set it in .sideteam.json");
    }
    if (!parseCommand(command)[0]) throw new Error("check command must specify a program");
    const files = await contextFiles(repo, input.files ?? []);

    const id = newId();
    const directory = dataDir(config, { env });
    const runDir = await createRunDir(directory, id);
    // Worktree creation registers its directory in Git's local exclude file.
    const worktree = await createWorktree(repo, id, { links: effectiveLinks(config) });
    const logPath = join(runDir, "engine.log");
    const checkOptions = {
      timeoutMs: config.limits.checkTimeoutMinutes * 60_000,
      lines: config.limits.checkLines,
    };
    let status: DelegationOutcome["status"] = "engine_failed";
    let reason: string | null = null;
    let result: EngineResult | undefined;
    let check: DelegationOutcome["check"];

    if (config.worktree.setup !== undefined) {
      const setup = await runCommandIn(worktree.path, config.worktree.setup, {
        ...checkOptions,
        logFile: join(runDir, "setup.log"),
        lines: 0,
      });
      if (!setup.passed) reason = `worktree setup failed (exit ${setup.code})`;
    }

    if (reason === null) {
      const prompt = framePrompt({ prompt: input.prompt, files, check: command });
      const promptFile = join(runDir, "prompt.md");
      await writeFile(promptFile, prompt);
      try {
        const cmd = adapter.buildCommand(
          { id, prompt, promptFile, worktree: worktree.path, runDir, model: cfg.model },
          cfg,
        );
        const raw = await run(
          { ...cmd, env: buildEngineEnv(cfg.env ?? [], env) },
          {
            logFile: logPath,
            timeoutMs: resolveTimeoutMinutes(input.timeoutMinutes, cfg, config.limits) * 60_000,
          },
        );
        if (raw.timedOut) {
          status = "timeout";
          reason = "engine timed out";
        }
        result = adapter.parseResult({ ...raw, runDir });
        reason ??= raw.spawnError ?? (result.ok ? null : (result.error ?? "engine failed"));
      } catch (error) {
        reason ??= error instanceof Error ? error.message : String(error);
      }
    }

    await commitAll(worktree.path, `Delegate ${id}`, { exclude: worktree.linked });
    if (reason === null) {
      const diff = await git(["diff", "--quiet", `${worktree.base}..${worktree.branch}`, "--"], {
        cwd: repo,
        allowFailure: true,
      });
      if (diff.code === 0) {
        reason = "no changes produced";
      } else if (diff.code === 1) {
        const checked = await runCommandIn(worktree.path, command, {
          ...checkOptions,
          logFile: join(runDir, "check.log"),
        });
        check = { command, code: checked.code, tail: checked.tail };
        status = checked.passed ? "success" : "check_failed";
        if (checked.timedOut) reason = "check timed out";
      } else {
        throw new Error(`could not inspect committed changes: ${diff.stderr.trim()}`);
      }
    }
    const changed = await changes(repo, worktree.base, worktree.branch);
    const durationMs = Date.now() - started;
    await writeMeta(directory, {
      id,
      repo,
      base: worktree.base,
      branch: worktree.branch,
      worktree: worktree.path,
      links: worktree.linked,
      engine,
      adapter: cfg.adapter,
      model: cfg.model ?? null,
      status,
      reason,
      startedAt,
      durationMs,
      tokens: result?.tokens ?? null,
      files: changed.files,
      check: check ? { command, code: check.code } : null,
    });
    return renderSummary(
      {
        id,
        engine,
        model: cfg.model ?? null,
        status,
        reason,
        durationMs,
        check,
        engineMessage: result?.message,
        base: worktree.base,
        logPath,
        ...changed,
      },
      config.limits,
    );
  } finally {
    clearInterval(timer);
  }
}
