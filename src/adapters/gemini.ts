import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildEngineEnv } from "../env.js";
import { findOnPath, resolveBin } from "./bin.js";
import type { DetectResult, EngineAdapter, EngineResult } from "./types.js";

const name = "gemini";
const key = "GEMINI_API_KEY";
const exec = promisify(execFile);
const versionTimeoutMs = 15_000;

function versionFrom(stdout: string): string | undefined {
  return stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.+-]+)?\b/)?.[0];
}

function parseOutput(stdout: string): {
  response?: unknown;
  error?: { message?: unknown } | string;
  stats?: { models?: Record<string, { tokens?: Record<string, unknown> } | null> };
} | null {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export const geminiAdapter: EngineAdapter = {
  name,

  async check(cfg) {
    const pass = cfg.env ?? [];
    const hasKey = pass.some((variable) => {
      const normalized = process.platform === "win32" ? variable.toUpperCase() : variable;
      return normalized === key || normalized === "GOOGLE_API_KEY";
    });
    const warning = hasKey
      ? undefined
      : "Neither GEMINI_API_KEY nor GOOGLE_API_KEY is listed in env";
    try {
      const { bin, prefix } = resolveBin(cfg, name);
      const { stdout } = await exec(bin, [...prefix, "--version"], {
        timeout: versionTimeoutMs,
        env: buildEngineEnv([]),
        windowsHide: true,
      });
      const version = versionFrom(stdout);
      return { ok: true, ...(version && { version }), ...(warning && { message: warning }) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: warning ? `${message}\n${warning}` : message };
    }
  },

  async detect(ctx) {
    const bin = findOnPath(name, ctx.env, ctx.platform);
    if (!bin) return { found: false };

    const result: DetectResult = { found: true, bin };
    try {
      const { code, stdout } = await ctx.run(bin, ["--version"], versionTimeoutMs);
      if (code === 0) result.version = versionFrom(stdout);
    } catch {
      // Version probing is best effort.
    }
    if (!result.version) result.notes = ["Unable to determine version"];

    const hasKey = Object.keys(ctx.env).some(
      (variable) => (ctx.platform === "win32" ? variable.toUpperCase() : variable) === key,
    );
    if (hasKey) result.proposal = { name, config: { adapter: name, env: [key] } };
    return result;
  },

  buildCommand(job, cfg) {
    const { bin, prefix } = resolveBin(cfg, name);
    const model = job.model ?? cfg.model;
    const args = [
      ...prefix,
      "-p",
      "Follow the task given on standard input.",
      "-o",
      "json",
      "--approval-mode",
      "yolo",
      ...(model ? ["-m", model] : []),
      ...(cfg.args ?? []),
    ];
    return { bin, args, cwd: job.worktree, env: buildEngineEnv(cfg.env ?? []), stdin: job.prompt };
  },

  parseResult(raw) {
    const output = parseOutput(raw.stdout);
    const message = typeof output?.response === "string" ? output.response : "";
    let tokens: EngineResult["tokens"] = null;
    for (const stats of Object.values(output?.stats?.models ?? {})) {
      const usage = stats?.tokens;
      const fields = {
        input: usage?.prompt ?? usage?.input,
        output: usage?.candidates,
        cached: usage?.cached,
      };
      for (const field of ["input", "output", "cached"] as const) {
        const value = fields[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
        tokens ??= {};
        tokens[field] = (tokens[field] ?? 0) + value;
      }
    }

    let error = raw.spawnError;
    if (error === undefined) {
      const detail = typeof output?.error === "string" ? output.error : output?.error?.message;
      if (raw.timedOut) error = "Engine timed out";
      else if (raw.code === 42) error = "invalid input (exit 42)";
      else if (raw.code === 53) error = "turn limit reached (exit 53)";
      else if (raw.code !== 0 || raw.signal) {
        const tail = (
          raw.stderr.trim() ||
          (typeof detail === "string" ? detail.trim() : "") ||
          raw.stdout.trim()
        )
          .split(/\r?\n/)
          .slice(-10)
          .join("\n")
          .slice(-1000);
        error = `Engine exited with ${raw.signal ?? raw.code}${tail ? `: ${tail}` : ""}`;
      } else if (output?.error != null) {
        error = (typeof detail === "string" && detail.trim()) || "Gemini reported an error";
      }
    }
    return error === undefined
      ? { ok: true, message, tokens }
      : { ok: false, message, tokens, error };
  },
};
