import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildEngineEnv } from "../env.js";
import { findOnPath, resolveBin } from "./bin.js";
import type { EngineAdapter, EngineResult } from "./types.js";

const name = "codex";
const versionTimeoutMs = 15_000;
const lastMessageFile = "last-message.txt";
const exec = promisify(execFile);
const usageFields = {
  input: "input_tokens",
  cached: "cached_input_tokens",
  output: "output_tokens",
} as const;

function versionFrom(stdout: string): string | undefined {
  return stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.+-]+)?\b/)?.[0];
}

export const codexAdapter: EngineAdapter = {
  name,

  async check(cfg) {
    try {
      const { bin, prefix } = resolveBin(cfg, name);
      const { stdout } = await exec(bin, [...prefix, "--version"], {
        timeout: versionTimeoutMs,
        env: buildEngineEnv(cfg.env ?? []),
        windowsHide: true,
      });
      const version = versionFrom(stdout);
      return version ? { ok: true, version } : { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  },

  async detect(ctx) {
    const bin = findOnPath(name, ctx.env, ctx.platform);
    if (!bin) return { found: false };

    const proposal = { name, config: { adapter: name } };
    try {
      const { code, stdout } = await ctx.run(bin, ["--version"], versionTimeoutMs);
      if (code === 0) {
        const version = versionFrom(stdout);
        if (version) return { found: true, bin, version, proposal };
      }
    } catch {
      // A failed version probe should not prevent detection of the executable.
    }
    return { found: true, bin, proposal, notes: ["Unable to determine version"] };
  },

  buildCommand(job, cfg) {
    const { bin, prefix } = resolveBin(cfg, name);
    const args = [
      ...prefix,
      "exec",
      "-s",
      "workspace-write",
      "-C",
      job.worktree,
      "--json",
      "-o",
      join(job.runDir, lastMessageFile),
    ];
    const model = job.model ?? cfg.model;
    if (model !== undefined) args.push("-m", model);
    if (cfg.options?.oss === true) {
      args.push("--oss");
      if (cfg.options.localProvider !== undefined) {
        args.push("--local-provider", String(cfg.options.localProvider));
      }
    }
    args.push(...(cfg.args ?? []), "-");
    return { bin, args, cwd: job.worktree, env: buildEngineEnv(cfg.env ?? []), stdin: job.prompt };
  },

  parseResult(raw) {
    let message = "";
    let error: string | undefined;
    let turnFailed = false;
    let tokens: EngineResult["tokens"] = null;

    for (const line of raw.stdout.split(/\r?\n/)) {
      let event: {
        type?: unknown;
        item?: { type?: unknown; text?: unknown };
        usage?: Record<string, unknown>;
        error?: { message?: unknown };
        message?: unknown;
      } | null;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (
        event?.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        message = event.item.text;
      }
      if (event?.type === "turn.completed") {
        for (const key of Object.keys(usageFields) as (keyof typeof usageFields)[]) {
          const value = event.usage?.[usageFields[key]];
          if (typeof value !== "number") continue;
          tokens ??= {};
          tokens[key] = (tokens[key] ?? 0) + value;
        }
      }
      if (event?.type === "error" && typeof event.message === "string") error = event.message;
      if (event?.type === "turn.failed") {
        turnFailed = true;
        if (typeof event.error?.message === "string") error = event.error.message;
      }
    }

    try {
      message = readFileSync(join(raw.runDir, lastMessageFile), "utf8");
    } catch {
      // The last completed message on stdout is also available when the file is missing.
    }

    const ok =
      raw.code === 0 && !raw.timedOut && !raw.signal && raw.spawnError === undefined && !turnFailed;
    return ok
      ? { ok, message, tokens }
      : {
          ok,
          message,
          tokens,
          error:
            raw.spawnError ??
            (raw.timedOut
              ? "Engine timed out"
              : (error ?? (raw.stderr.trim() || `Engine exited with ${raw.signal ?? raw.code}`))),
        };
  },
};
