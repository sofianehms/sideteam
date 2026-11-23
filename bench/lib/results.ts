import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrialResult } from "./trial.js";

export function writeJson(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

export function appendTrial(out: string, result: TrialResult) {
  appendFileSync(join(out, "trials.jsonl"), `${JSON.stringify(result)}\n`);
}

export function readTrials(out: string): TrialResult[] {
  const file = join(out, "trials.jsonl");
  if (!existsSync(file)) return [];
  const trials = new Map<string, TrialResult>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const trial: TrialResult = JSON.parse(line);
    trials.set(trial.key, trial);
  }
  return [...trials.values()];
}

function median(values: (number | null)[]): number | null {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function unique(values: (string | null)[]) {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}

export function summarize(
  trials: TrialResult[],
  planned = trials.length,
  date = new Date().toISOString(),
) {
  const levels = ["easy", "medium", "hard"] as const;
  const rows = levels.flatMap((level) => {
    const groups = new Map<string | null, TrialResult[]>();
    for (const trial of trials.filter((trial) => trial.level === level)) {
      const group = groups.get(trial.engine) ?? [];
      group.push(trial);
      groups.set(trial.engine, group);
    }
    const summaries = [...groups].map(([engine, group]) => {
      const successes = group.filter((trial) => trial.success).length;
      const engineCostKnown = group.every((trial) => trial.engineCost !== null);
      const claudeCostKnown = group.every((trial) => trial.claudeCost !== null);
      const totalCost = group.reduce(
        (sum, trial) => sum + (trial.claudeCost ?? 0) + (trial.engineCost ?? 0),
        0,
      );
      return {
        level,
        arm: group[0].arm,
        engine,
        trials: group.length,
        successes,
        successRate: successes / group.length,
        medianClaudeTokens: median(
          group.map(({ claudeTokens: tokens }) =>
            tokens ? tokens.input + tokens.output + tokens.cacheCreation : null,
          ),
        ),
        medianCacheRead: median(group.map(({ claudeTokens }) => claudeTokens?.cacheRead ?? null)),
        medianEngineTokens: median(
          group.map(({ engineTokens: tokens }) =>
            tokens ? tokens.input + tokens.output + tokens.cached : null,
          ),
        ),
        medianDurationMs: median(group.map(({ durationMs }) => durationMs)),
        engineCostKnown,
        costPerSuccessfulTask:
          successes && engineCostKnown && claudeCostKnown ? totalCost / successes : null,
      };
    });
    const baseline = summaries.find(({ arm }) => arm === "A")?.medianClaudeTokens;
    return summaries.map((row) => ({
      ...row,
      savings:
        row.arm === "B" && baseline && row.medianClaudeTokens !== null
          ? 1 - row.medianClaudeTokens / baseline
          : null,
    }));
  });
  const engines = unique(trials.map(({ engine }) => engine));
  return {
    date,
    coverage: { completed: trials.length, planned, partial: trials.length < planned },
    claude: {
      versions: unique(trials.map(({ versions }) => versions.claude)),
      models: unique(trials.flatMap(({ models }) => models.claude)),
    },
    engines: engines.map((name) => {
      const group = trials.filter(({ engine }) => engine === name);
      return {
        name,
        versions: unique(group.map(({ versions }) => versions.engine)),
        models: unique(group.flatMap(({ models }) => models.engine)),
      };
    }),
    rows,
  };
}

export function renderMarkdown(report: ReturnType<typeof summarize>) {
  const { completed, planned, partial } = report.coverage;
  const list = (items: string[]) => items.join(", ") || "n/a";
  const number = (value: number | null) => (value === null ? "n/a" : String(value));
  const percent = (value: number | null) =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    "# Benchmark results",
    "",
    `Date: ${report.date}`,
    `Coverage: ${completed}/${planned} trials${partial ? " (partial)" : ""}`,
    "",
    `- Claude versions: ${list(report.claude.versions)}. Models: ${list(report.claude.models)}.`,
    ...report.engines.map(
      ({ name, versions, models }) =>
        `- ${name} versions: ${list(versions)}. Models: ${list(models)}.`,
    ),
    "",
    "| Level | Arm | Engine | Success rate | Median Claude tokens | Median cache read | Savings (1 − B/A) | Median engine tokens | Median duration (s) | Cost per successful task (USD) |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.rows.map((row) => {
      const cost = !row.engineCostKnown
        ? "engine cost n/a"
        : row.costPerSuccessfulTask === null
          ? "n/a"
          : `$${row.costPerSuccessfulTask.toFixed(6)}`;
      return `| ${row.level} | ${row.arm} | ${row.engine ?? "—"} | ${percent(row.successRate)} | ${number(row.medianClaudeTokens)} | ${number(row.medianCacheRead)} | ${percent(row.savings)} | ${number(row.medianEngineTokens)} | ${row.medianDurationMs === null ? "n/a" : (row.medianDurationMs / 1000).toFixed(3)} | ${cost} |`;
    }),
    "",
  ].join("\n");
}

export function writeReport(out: string) {
  const trials = readTrials(out);
  const plan = readJson<string[]>(join(out, "plan.json"));
  const report = summarize(
    trials,
    plan ? new Set([...plan, ...trials.map(({ key }) => key)]).size : trials.length,
  );
  writeJson(join(out, "results.json"), report);
  writeFileSync(join(out, "results.md"), renderMarkdown(report));
}
