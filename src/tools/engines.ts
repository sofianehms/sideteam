import { execFile } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { allAdapters } from "../adapters/index.js";
import type { CheckResult, DetectContext } from "../adapters/types.js";
import { loadConfig } from "../config.js";
import { detectAll, guessCheck } from "../detect.js";
import { buildEngineEnv } from "../env.js";
import { git } from "../git.js";

const checkTimeoutMs = 15_000;

async function checkEngine(check: () => Promise<CheckResult>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<CheckResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, message: "Check timed out after 15 s" }),
        checkTimeoutMs,
      );
    });
    return await Promise.race([timeout, check()]);
  } catch {
    return { ok: false, message: "Unable to check executable" };
  } finally {
    clearTimeout(timer);
  }
}

function environmentRedactor(env: Record<string, string>) {
  // NO_COLOR is set to a fixed value by buildEngineEnv.
  const { NO_COLOR: _noColor, ...inherited } = env;
  const values = Object.values(inherited)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const pattern = values.length
    ? new RegExp(values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
    : undefined;
  return (text: string | undefined) => (pattern ? text?.replace(pattern, "[redacted]") : text);
}

function cell(value: string | undefined, limit = 64): string {
  if (value === undefined) return "-";
  const text = value.replace(/\s+/g, " ").replaceAll("|", "/").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export async function inspectEngines(
  { detect }: { detect?: boolean },
  cwd = process.cwd(),
): Promise<string> {
  const root = await git(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true });
  const repoRoot = root.code === 0 ? root.stdout.replace(/\r?\n$/, "") : cwd;
  if (detect) {
    const env = buildEngineEnv([]);
    const redact = environmentRedactor(env);
    const run: DetectContext["run"] = (bin, args, timeout) =>
      new Promise((resolve) => {
        execFile(bin, args, { cwd: repoRoot, env, timeout, windowsHide: true }, (error, stdout) => {
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : null) : 0,
            stdout: redact(stdout) === stdout ? stdout : "",
          });
        });
      });
    const proposal = await detectAll({
      adapters: allAdapters(),
      env,
      platform: process.platform,
      run,
    });
    return JSON.stringify({ ...proposal, check: guessCheck(repoRoot) }, null, 2);
  }

  try {
    const { config, sources } = loadConfig({ repoRoot });
    const adapters = allAdapters();
    const rows = await Promise.all(
      Object.entries(config.engines).map(async ([name, cfg]) => {
        const redact = environmentRedactor(buildEngineEnv(cfg.env ?? []));
        const adapter = adapters.find((adapter) => adapter.name === cfg.adapter);
        const result = adapter
          ? await checkEngine(() => adapter.check(cfg))
          : { ok: false, message: "Unknown adapter" };
        return [
          cell(name),
          cell(cfg.adapter),
          cell(cfg.model),
          cfg.privacy,
          config.default === name ? "yes" : "no",
          result.deferred ? "unknown" : result.ok ? "yes" : "no",
          cell(redact(result.version), 32),
          cell(redact(result.message)?.trimEnd().split(/\r?\n/).at(-1), 96),
        ].join(" | ");
      }),
    );
    const table = [
      "Name | Adapter | Model | Privacy | Default | Installed | Version | Message",
      "--- | --- | --- | --- | --- | --- | --- | ---",
      ...rows,
      "",
      `Configuration files read: ${sources.join(", ") || "none"}`,
    ];
    return table.join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Configuration error: ${message}`;
  }
}

export function registerEngines(server: McpServer) {
  server.registerTool(
    "engines",
    {
      description: "Check configured engines or detect engines and propose a configuration.",
      inputSchema: z.object({ detect: z.boolean().optional() }),
    },
    async (args) => ({ content: [{ type: "text", text: await inspectEngines(args) }] }),
  );
}
