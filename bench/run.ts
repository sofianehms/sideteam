import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildEngineEnv } from "../src/env.js";
import { run } from "../src/runner.js";
import { copyPlugin } from "./lib/plugin-copy.js";
import { appendTrial, readJson, readTrials, writeJson, writeReport } from "./lib/results.js";
import { type BenchmarkEngine, planSeries, selectEngines } from "./lib/series.js";
import { loadTasks } from "./lib/tasks.js";
import { QuotaReached, runTrial } from "./lib/trial.js";

function parseOptions(args: string[]) {
  const report = args[0] === "report";
  const { values, tokens } = parseArgs({
    tokens: true,
    args: report ? args.slice(1) : args,
    options: {
      out: { type: "string" },
      series: { type: "string" },
      engines: { type: "string" },
      reps: { type: "string" },
      "trial-timeout": { type: "string" },
    },
  });
  if (report && tokens.some((token) => token.kind === "option" && token.name !== "out")) {
    throw new Error("The report command accepts only --out");
  }
  const series = values.series ?? "light";
  if (series !== "light" && series !== "full") throw new Error("Expected --series light or full");
  const reps = values.reps === undefined ? undefined : Number(values.reps);
  if (reps !== undefined && (!Number.isSafeInteger(reps) || reps <= 0)) {
    throw new Error("Expected a positive integer for --reps");
  }
  const timeoutMs = Math.floor(Number(values["trial-timeout"] ?? 20) * 60_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error("Expected a positive --trial-timeout in minutes within the timer range");
  }
  const engines = values.engines?.split(",").map((name) => name.trim());
  if (engines?.some((name) => !/^[\w.-]+$/.test(name))) {
    throw new Error("Expected comma-separated engine names for --engines");
  }
  return { report, series, out: values.out, reps, timeoutMs, engines } as const;
}

async function main(args: string[]) {
  const root = process.cwd();
  const binary = process.env.SIDETEAM_BENCH_CLAUDE_BIN ?? "claude";
  const claudeBin = /[\\/]/.test(binary) ? resolve(root, binary) : binary;
  const options = parseOptions(args);
  const out = resolve(root, options.out ?? join("bench", "results", options.series));
  if (options.report) {
    writeReport(out);
    return 0;
  }

  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const { signal } = controller;
  const scratch = mkdtempSync(join(tmpdir(), "sideteam-bench-"));
  process.on("SIGINT", interrupt);
  try {
    const configs = readJson<Record<string, BenchmarkEngine>>(join(root, "bench", "engines.json"));
    if (!configs) throw new Error("Missing bench/engines.json");
    const engines = await selectEngines(options.series, configs, options.engines);
    signal.throwIfAborted();
    const plan = planSeries(
      loadTasks(join(root, "bench", "tasks")),
      options.series,
      engines,
      options.reps,
    );
    const completed = new Set(readTrials(out).map(({ key }) => key));
    const pending = plan.filter(({ key }) => !completed.has(key));
    console.log(`skipping ${plan.length - pending.length} completed trials`);
    mkdirSync(out, { recursive: true });
    const planFile = join(out, "plan.json");
    const planned = new Set([
      ...(readJson<string[]>(planFile) ?? []),
      ...completed,
      ...plan.map(({ key }) => key),
    ]);
    writeJson(planFile, [...planned]);

    if (pending.length) {
      const version = await run(
        { bin: claudeBin, args: ["--version"], cwd: scratch, env: buildEngineEnv([]) },
        { timeoutMs: 15_000, logFile: join(scratch, "version.log"), signal },
      );
      signal.throwIfAborted();
      if (version.spawnError) throw new Error(version.spawnError);
      const plugin = await copyPlugin(root, scratch, signal);
      for (const trial of pending) {
        try {
          const result = await runTrial(trial, {
            scratch,
            plugin,
            claudeBin,
            claudeVersion: version.code === 0 ? version.stdout.trim() || null : null,
            timeoutMs: options.timeoutMs,
            signal,
          });
          signal.throwIfAborted();
          appendTrial(out, result);
          completed.add(trial.key);
        } catch (error) {
          if (!(error instanceof QuotaReached)) throw error;
          writeJson(join(out, "state.json"), {
            stoppedAt: new Date().toISOString(),
            reason: error.message,
          });
          console.log(
            `Quota reached after ${completed.size}/${planned.size} trials; rerun the same command later to resume.`,
          );
          return 75;
        }
      }
    }
    rmSync(join(out, "state.json"), { force: true });
    return 0;
  } catch (error) {
    if (signal.aborted) return 130;
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    rmSync(scratch, { force: true, recursive: true });
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
