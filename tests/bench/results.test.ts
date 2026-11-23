import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { appendTrial, renderMarkdown, summarize, writeJson } from "../../bench/lib/results.js";
import type { TrialResult } from "../../bench/lib/trial.js";

const baseline: TrialResult = {
  key: "a1",
  task: "01-ts-test",
  arm: "A",
  engine: null,
  repetition: 1,
  level: "easy",
  language: "ts",
  success: true,
  timeout: false,
  claudeTokens: { input: 30, output: 10, cacheCreation: 20, cacheRead: 100 },
  claudeCost: 0.25,
  engineTokens: null,
  engineCost: 0,
  delegations: 0,
  durationMs: 1000,
  versions: { claude: "1.2.3", engine: null },
  models: { claude: ["claude-test"], engine: [] },
};
const armB: TrialResult = {
  ...baseline,
  key: "b1",
  arm: "B",
  engine: "metered",
  claudeTokens: { input: 10, output: 10, cacheCreation: 5, cacheRead: 200 },
  engineTokens: { input: 20, output: 10, cached: 5 },
  engineCost: 0.125,
  delegations: 1,
  durationMs: 4000,
  versions: { claude: "1.2.3", engine: "2.3.4" },
  models: { claude: ["claude-test"], engine: ["engine-test"] },
};
const trials = [
  baseline,
  {
    ...baseline,
    key: "a2",
    claudeTokens: { input: 70, output: 10, cacheCreation: 10, cacheRead: 300 },
    durationMs: 3000,
  },
  armB,
  {
    ...armB,
    key: "b2",
    success: false,
    claudeTokens: { input: 20, output: 20, cacheCreation: 10, cacheRead: 400 },
  },
  { ...armB, key: "b3", engine: "local", engineCost: null },
];

test("reports medians, savings, measured costs and partial coverage", () => {
  const report = summarize(trials, 6, "2026-01-01");
  const [a, b, local] = report.rows;
  expect(a).toMatchObject({
    medianClaudeTokens: 75,
    medianCacheRead: 200,
    medianDurationMs: 2000,
    costPerSuccessfulTask: 0.25,
  });
  expect(b).toMatchObject({
    successRate: 0.5,
    medianClaudeTokens: 37.5,
    medianCacheRead: 300,
    savings: 0.5,
    medianEngineTokens: 35,
    costPerSuccessfulTask: 0.75,
  });
  expect(local).toMatchObject({
    engineCostKnown: false,
    medianEngineTokens: 35,
    costPerSuccessfulTask: null,
  });
  const markdown = renderMarkdown(report);
  expect(markdown).toContain("5/6 trials (partial)");
  expect(markdown).toContain("Savings (1 − B/A)");
  expect(markdown).toContain("50.0%");
  expect(markdown).toContain("$0.750000");
  expect(markdown).toContain("engine cost n/a");
  expect(markdown).toContain("2.3.4. Models: engine-test.");
});

test("npm run bench -- report writes JSON and Markdown from the journal", () => {
  const out = mkdtempSync(join(tmpdir(), "sideteam-report-"));
  try {
    for (const trial of trials) appendTrial(out, trial);
    writeJson(join(out, "plan.json"), [...trials.map(({ key }) => key), "missing"]);
    execFileSync("npm", ["run", "bench", "--", "report", "--out", out], { stdio: "pipe" });
    expect(JSON.parse(readFileSync(join(out, "results.json"), "utf8"))).toMatchObject({
      coverage: { completed: 5, planned: 6, partial: true },
      rows: [
        { arm: "A" },
        { savings: 0.5, costPerSuccessfulTask: 0.75 },
        { engineCostKnown: false },
      ],
    });
    expect(readFileSync(join(out, "results.md"), "utf8")).toContain("$0.750000");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
