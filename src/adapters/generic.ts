import { buildEngineEnv } from "../env.js";
import { findOnPath } from "./bin.js";
import type { EngineAdapter } from "./types.js";

const name = "generic";

export function hasRequiredCommand(cfg: { adapter: string; command?: string[] }): boolean {
  return cfg.adapter !== name || cfg.command !== undefined;
}

export const genericAdapter: EngineAdapter = {
  name,

  async check(cfg) {
    const bin = cfg.command?.[0];
    if (!bin) return { ok: false, message: "command must specify a program" };
    return findOnPath(bin, process.env, process.platform)
      ? { ok: true }
      : { ok: false, message: `Program not found: ${bin}` };
  },

  async detect() {
    return { found: false };
  },

  buildCommand(job, cfg) {
    const variables = {
      prompt_file: job.promptFile,
      cwd: job.worktree,
      model: job.model ?? cfg.model,
    };
    const [bin, ...args] = (cfg.command ?? []).map((element) =>
      element.replace(/\{(prompt_file|cwd|model)\}/g, (_, name: keyof typeof variables) => {
        const value = variables[name];
        if (value === undefined) throw new Error("{model} requires a configured model");
        return value;
      }),
    );
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
