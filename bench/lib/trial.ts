import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildEngineEnv } from "../../src/env.js";
import { run } from "../../src/runner.js";
import type { Trial } from "./series.js";
import { copyTask } from "./tasks.js";

type ClaudeOutput = {
  is_error?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd?: number;
  model?: string;
  modelUsage?: Record<string, unknown>;
};

type EngineMeta = {
  tokens?: { input?: number; output?: number; cached?: number } | null;
  model?: string | null;
};

export type TrialResult = {
  key: string;
  task: string;
  arm: Trial["arm"];
  engine: string | null;
  repetition: number;
  level: Trial["task"]["level"];
  language: Trial["task"]["language"];
  success: boolean;
  timeout: boolean;
  claudeTokens: { input: number; output: number; cacheCreation: number; cacheRead: number } | null;
  claudeCost: number | null;
  engineTokens: { input: number; output: number; cached: number } | null;
  engineCost: number | null;
  delegations: number;
  durationMs: number;
  versions: { claude: string | null; engine: string | null };
  models: { claude: string[]; engine: string[] };
};

export class QuotaReached extends Error {}

function parseOutput(stdout: string): ClaudeOutput | null {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function engineRuns(dataDir: string): EngineMeta[] {
  const runs = join(dataDir, "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs, { withFileTypes: true }).flatMap((entry) => {
    const file = join(runs, entry.name, "meta.json");
    return entry.isDirectory() && existsSync(file) ? [JSON.parse(readFileSync(file, "utf8"))] : [];
  });
}

export async function runTrial(
  trial: Trial,
  options: {
    scratch: string;
    plugin?: string;
    claudeBin: string;
    claudeVersion: string | null;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<TrialResult> {
  const scratch = mkdtempSync(join(options.scratch, "trial-"));
  const cwd = join(scratch, "repo");
  const dataDir = join(scratch, "data");
  const { engine, task } = trial;
  const { signal } = options;
  const env = buildEngineEnv([
    ...(engine?.config.env ?? []),
    "FAKE_CLAUDE",
    "FAKE_CLAUDE_SOLUTION",
    "FAKE_CLAUDE_COUNTER",
  ]);
  const execute = async (
    bin: string,
    args: string[],
    timeoutMs: number,
    log: string,
    commandEnv = env,
  ) => {
    const result = await run(
      { bin, args, cwd, env: commandEnv },
      { timeoutMs, logFile: join(scratch, log), signal },
    );
    signal?.throwIfAborted();
    return result;
  };

  try {
    copyTask(task, cwd, { withSolution: false, withHidden: false });
    const gitEnv = {
      ...buildEngineEnv([]),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(scratch, "gitconfig"),
    };
    for (const args of [
      ["init", "--template="],
      ["config", "--local", "user.name", "SideTeam Benchmark"],
      ["config", "--local", "user.email", "benchmark@example.invalid"],
      ["add", "--all"],
      [
        "-c",
        "core.hooksPath=.git/hooks",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        "Initial task",
      ],
    ]) {
      const git = await execute("git", args, 15_000, "git.log", gitEnv);
      if (git.code !== 0) throw new Error(`Unable to initialize trial repository: ${git.stderr}`);
    }

    let prompt = `${task.prompt}\n\nRun the visible check before finishing: ${JSON.stringify(task.check)}.`;
    const args = ["--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (engine) {
      if (!options.plugin) throw new Error("Arm B requires a plugin copy");
      writeFileSync(
        join(cwd, ".sideteam.json"),
        JSON.stringify({
          default: engine.name,
          engines: { [engine.name]: engine.config },
          fallback: [],
          check: task.check,
          dataDir,
        }),
      );
      prompt += `\nYou may delegate with the delegate tool using the "${engine.name}" engine. Review the proposed changes and apply or fix them before finishing.`;
      args.push("--plugin-dir", options.plugin);
    }

    const started = performance.now();
    const execution = await execute(
      options.claudeBin,
      ["-p", prompt, ...args],
      options.timeoutMs,
      "claude.log",
    );
    if (execution.spawnError) throw new Error(execution.spawnError);
    const output = parseOutput(execution.stdout);
    if (!execution.timedOut && (execution.code !== 0 || output?.is_error)) {
      const quota = /usage limit|rate limit|quota|limit reached/i.exec(
        `${execution.stdout}\n${execution.stderr}`,
      );
      if (quota) throw new QuotaReached(quota[0]);
    }

    let timeout = execution.timedOut;
    let success = false;
    if (!timeout) {
      const hidden = join(cwd, "hidden");
      rmSync(hidden, { recursive: true, force: true });
      cpSync(join(task.directory, "hidden"), hidden, { recursive: true });
      const remaining = Math.floor(options.timeoutMs - (performance.now() - started));
      timeout = remaining <= 0;
      if (!timeout) {
        const [bin, ...checkArgs] = task.hidden;
        const judged = await execute(bin, checkArgs, remaining, "hidden.log", buildEngineEnv([]));
        if (judged.spawnError) throw new Error(judged.spawnError);
        timeout = judged.timedOut;
        success = !timeout && judged.code === 0;
      }
    }
    const durationMs = performance.now() - started;

    const delegations = engine ? engineRuns(dataDir) : [];
    const engineTokens = engine
      ? delegations.reduce(
          (sum, { tokens }) => ({
            input: sum.input + (tokens?.input ?? 0),
            output: sum.output + (tokens?.output ?? 0),
            cached: sum.cached + (tokens?.cached ?? 0),
          }),
          { input: 0, output: 0, cached: 0 },
        )
      : null;
    const price = engine?.pricePerMTok;
    const usage = output?.usage;
    return {
      key: trial.key,
      task: task.id,
      arm: trial.arm,
      engine: engine?.name ?? null,
      repetition: trial.repetition,
      level: task.level,
      language: task.language,
      success,
      timeout,
      claudeTokens: usage
        ? {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            cacheCreation: usage.cache_creation_input_tokens ?? 0,
            cacheRead: usage.cache_read_input_tokens ?? 0,
          }
        : null,
      claudeCost: output?.total_cost_usd ?? null,
      engineTokens,
      engineCost: engine
        ? price && engineTokens
          ? (engineTokens.input * price.input + engineTokens.output * price.output) / 1_000_000
          : null
        : 0,
      delegations: delegations.length,
      durationMs,
      versions: { claude: options.claudeVersion, engine: engine?.version ?? null },
      models: {
        claude: Object.keys(output?.modelUsage ?? (output?.model ? { [output.model]: true } : {})),
        engine: [
          ...new Set(
            [engine?.config.model, ...delegations.map(({ model }) => model)].filter(
              (model): model is string => Boolean(model),
            ),
          ),
        ],
      },
    };
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
