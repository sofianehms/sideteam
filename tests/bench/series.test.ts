import { expect, test, vi } from "vitest";
import {
  type BenchmarkEngine,
  planSeries,
  requestedEngines,
  selectEngines,
  skippedEngines,
} from "../../bench/lib/series.js";
import type { Task } from "../../bench/lib/tasks.js";

const tasks: Task[] = Array.from({ length: 12 }, (_, index) => {
  const language = index < 6 ? "ts" : "py";
  const id = `${String(index + 1).padStart(2, "0")}-${language}-test`;
  return {
    id,
    language,
    level: "easy",
    light: index % 2 === 0,
    directory: id,
    prompt: "Fix the task.",
    check: ["node", "--test"],
    hidden: ["node", "--test", "hidden/hidden.test.mjs"],
  };
});
const engines = {
  codex: { adapter: "codex" },
  local: { adapter: "opencode" },
  gemini: { adapter: "gemini" },
} satisfies Record<string, BenchmarkEngine>;
const available = () => ({ check: async () => ({ ok: true, version: "1.0.0" }) });

test("the default light series has 18 unique trials", async () => {
  const selected = await selectEngines("light", engines, undefined, vi.fn(), available);
  expect(selected.map(({ name }) => name)).toEqual(["codex", "local"]);
  const trials = planSeries(tasks, "light", selected);
  expect(trials).toHaveLength(18);
  expect(new Set(trials.map(({ key }) => key)).size).toBe(18);
});

test("the full series has 144 trials with three available engines", async () => {
  const selected = await selectEngines("full", engines, undefined, vi.fn(), available);
  const trials = planSeries(tasks, "full", selected);
  expect(trials).toHaveLength(144);
  expect(trials.filter(({ arm }) => arm === "A")).toHaveLength(36);
});

test("explicit selection replaces defaults and skips unavailable engines with a message", async () => {
  const announce = vi.fn();
  const selected = await selectEngines("light", engines, ["gemini", "local"], announce, (name) =>
    name === "opencode" ? { check: async () => ({ ok: false, message: "offline" }) } : available(),
  );
  expect(selected.map(({ name }) => name)).toEqual(["gemini"]);
  expect(announce).toHaveBeenCalledWith('Skipping engine "local": offline');
  expect(planSeries(tasks, "light", selected)).toHaveLength(12);
});

test("requested engines that are unavailable remain planned for coverage", async () => {
  const selected = await selectEngines("light", engines, undefined, vi.fn(), (name) =>
    name === "opencode" ? { check: async () => ({ ok: false, message: "offline" }) } : available(),
  );
  const skipped = skippedEngines(requestedEngines("light", engines), engines, selected);
  expect(skipped.map(({ name }) => name)).toEqual(["local"]);
  const missing = planSeries(tasks, "light", skipped).filter(({ engine }) => engine);
  expect(missing).toHaveLength(6);
  expect(planSeries(tasks, "light", selected).length + missing.length).toBe(18);
  expect(skippedEngines(["unknown"], engines, selected)).toEqual([]);
});
