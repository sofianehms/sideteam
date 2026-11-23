import type { EngineConfig } from "../config.js";
import { buildEngineEnv } from "../env.js";
import { findOnPath } from "./bin.js";
import type { EngineAdapter, Job } from "./types.js";

const name = "generic";

function commandVariablePattern() {
  return /\{(prompt_file|cwd|model)\}/g;
}

function expand(element: string, job: Job, cfg: EngineConfig): string {
  const variables = {
    prompt_file: job.promptFile,
    cwd: job.worktree,
    model: job.model ?? cfg.model,
  };
  return element.replace(commandVariablePattern(), (_, name: keyof typeof variables) => {
    const value = variables[name];
    if (value === undefined) throw new Error("{model} requires a configured model");
    return value;
  });
}

export function hasRequiredCommand(cfg: { adapter: string; command?: string[] }): boolean {
  return cfg.adapter !== name || cfg.command !== undefined;
}

export const genericAdapter: EngineAdapter = {
  name,

  async check(cfg, job) {
    const executable = cfg.command?.[0];
    if (!executable) return { ok: false, message: "command must specify a program" };
    if (!job && commandVariablePattern().test(executable)) {
      return { ok: false, deferred: true, message: "Executable expansion requires a job" };
    }
    try {
      const bin = job ? expand(executable, job, cfg) : executable;
      if (!bin) return { ok: false, message: "command must specify a program" };
      return findOnPath(bin, buildEngineEnv(cfg.env ?? []), process.platform)
        ? { ok: true }
        : { ok: false, message: `Program not found: ${bin}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  async detect() {
    return { found: false };
  },

  buildCommand(job, cfg) {
    const [bin, ...args] = (cfg.command ?? []).map((element) => expand(element, job, cfg));
    if (!bin) throw new Error("command must specify a program");
    return { bin, args, cwd: job.worktree, env: buildEngineEnv(cfg.env ?? []) };
  },

  parseResult(raw) {
    const lines = raw.stdout.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const message = lines.slice(-40).join("\n");
    const ok = raw.code === 0 && !raw.timedOut && !raw.signal && raw.spawnError === undefined;
    return ok
      ? { ok, message, tokens: null }
      : {
          ok,
          message,
          tokens: null,
          error:
            raw.spawnError ??
            (raw.timedOut
              ? "Engine timed out"
              : raw.stderr.trim() || `Engine exited with ${raw.signal ?? raw.code}`),
        };
  },
};
