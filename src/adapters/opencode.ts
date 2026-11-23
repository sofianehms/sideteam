import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildEngineEnv } from "../env.js";
import { findOnPath, resolveBin } from "./bin.js";
import type { DetectResult, EngineAdapter, EngineResult } from "./types.js";

const name = "opencode";
const exec = promisify(execFile);
const versionTimeoutMs = 15_000;

function versionFrom(stdout: string): string | undefined {
  return stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.+-]+)?\b/)?.[0];
}

function preferredModel(stdout: string): string | undefined {
  const models = stdout
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  return (
    models.find((model) => /(?:^|\/)qwen3-coder(?:[:.-]|$)/i.test(model)) ??
    models.find((model) => /(?:^|\/)devstral(?:[:.-]|$)/i.test(model)) ??
    models[0]
  );
}

export const opencodeAdapter: EngineAdapter = {
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

    const result: DetectResult = { found: true, bin };
    try {
      const { code, stdout } = await ctx.run(bin, ["--version"], versionTimeoutMs);
      if (code === 0) result.version = versionFrom(stdout);
    } catch {
      // Version probing is best effort.
    }
    if (!result.version) result.notes = ["Unable to determine version"];

    const ollama = findOnPath("ollama", ctx.env, ctx.platform);
    if (ollama) {
      try {
        const { code, stdout } = await ctx.run(ollama, ["list"], 10_000);
        const model = code === 0 ? preferredModel(stdout) : undefined;
        if (model) {
          result.proposal = {
            name: "local",
            config: { adapter: name, model: `ollama/${model}`, privacy: "local" },
          };
        }
      } catch {
        // An unavailable Ollama service does not affect detection.
      }
    }
    return result;
  },

  buildCommand(job, cfg) {
    const model = job.model ?? cfg.model;
    if (!model || !/^[^/\s]+\/\S+$/.test(model) || model.startsWith("-")) {
      throw new Error("opencode engine requires model as provider/model");
    }

    const { bin, prefix } = resolveBin(cfg, name);
    const args = [
      ...prefix,
      "run",
      "-m",
      model,
      "--format",
      "json",
      "--dir",
      job.worktree,
      "--auto",
      ...(cfg.args ?? []),
    ];
    // OpenCode reads the prompt from standard input, so it never appears in the process list.
    return { bin, args, cwd: job.worktree, env: buildEngineEnv(cfg.env ?? []), stdin: job.prompt };
  },

  parseResult(raw) {
    let lastText: string[] = [];
    let stepText: string[] = [];
    let error: string | undefined;
    let tokens: EngineResult["tokens"] = null;

    for (const line of raw.stdout.split(/\r?\n/)) {
      let event: {
        type?: unknown;
        part?: {
          text?: unknown;
          tokens?: { input?: unknown; output?: unknown; cache?: { read?: unknown } };
        };
        error?: { data?: { message?: unknown }; message?: unknown } | string;
        message?: unknown;
      } | null;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event?.type === "step_start") stepText = [];
      if (event?.type === "text" && typeof event.part?.text === "string") {
        stepText.push(event.part.text);
        lastText = stepText;
      }
      if (event?.type === "step_finish") {
        const usage = event.part?.tokens;
        const fields = { input: usage?.input, output: usage?.output, cached: usage?.cache?.read };
        for (const key of ["input", "output", "cached"] as const) {
          const value = fields[key];
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
          tokens ??= {};
          tokens[key] = (tokens[key] ?? 0) + value;
        }
      }
      if (event?.type === "error") {
        const detail =
          typeof event.error === "string"
            ? event.error
            : (event.error?.data?.message ?? event.error?.message ?? event.message);
        error =
          (typeof detail === "string" && detail.trim()) || error || "OpenCode reported an error";
      }
    }

    const message = lastText.join("\n");
    const ok =
      raw.code === 0 &&
      !raw.timedOut &&
      !raw.signal &&
      raw.spawnError === undefined &&
      error === undefined;
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
