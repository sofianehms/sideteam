import { getAdapter } from "../../src/adapters/index.js";
import type { EngineAdapter } from "../../src/adapters/types.js";
import type { EngineConfig } from "../../src/config.js";
import type { Task } from "./tasks.js";

export type Series = "light" | "full";
export type BenchmarkEngine = EngineConfig & {
  pricePerMTok?: { input: number; output: number };
};
export type AvailableEngine = {
  name: string;
  config: EngineConfig;
  pricePerMTok?: BenchmarkEngine["pricePerMTok"];
  version: string | null;
};
export type Trial = {
  key: string;
  task: Task;
  arm: "A" | "B";
  engine: AvailableEngine | null;
  repetition: number;
};

export function requestedEngines(
  series: Series,
  engines: Record<string, BenchmarkEngine>,
  names?: string[],
): string[] {
  return [...new Set(names ?? (series === "light" ? ["codex", "local"] : Object.keys(engines)))];
}

export async function selectEngines(
  series: Series,
  engines: Record<string, BenchmarkEngine>,
  names = requestedEngines(series, engines),
  announce = console.log,
  adapterFor: (name: string) => Pick<EngineAdapter, "check"> = getAdapter,
): Promise<AvailableEngine[]> {
  const available: AvailableEngine[] = [];
  for (const name of requestedEngines(series, engines, names)) {
    if (!Object.hasOwn(engines, name)) {
      announce(`Skipping engine "${name}": no configuration`);
      continue;
    }
    const { pricePerMTok, ...config } = engines[name];
    try {
      const check = await adapterFor(config.adapter).check(config);
      if (check.ok) {
        available.push({ name, config, pricePerMTok, version: check.version ?? null });
        continue;
      }
      announce(`Skipping engine "${name}": ${check.message ?? "unavailable"}`);
    } catch (error) {
      announce(`Skipping engine "${name}": ${String(error)}`);
    }
  }
  return available;
}

export function planSeries(
  tasks: Task[],
  series: Series,
  engines: AvailableEngine[],
  reps = series === "light" ? 1 : 3,
): Trial[] {
  const trials: Trial[] = [];
  for (const task of tasks) {
    if (series === "light" && !task.light) continue;
    for (let repetition = 1; repetition <= reps; repetition++) {
      for (const engine of [null, ...engines]) {
        const arm = engine ? "B" : "A";
        trials.push({
          key: `${task.id}|${arm}|${engine?.name ?? ""}|${repetition}`,
          task,
          arm,
          engine,
          repetition,
        });
      }
    }
  }
  return trials;
}

export function skippedEngines(
  requested: string[],
  engines: Record<string, BenchmarkEngine>,
  available: AvailableEngine[],
): AvailableEngine[] {
  return requested
    .filter(
      (name) => Object.hasOwn(engines, name) && !available.some((engine) => engine.name === name),
    )
    .map((name) => {
      const { pricePerMTok, ...config } = engines[name];
      return { name, config, pricePerMTok, version: null };
    });
}
