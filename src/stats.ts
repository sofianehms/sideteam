import type { JournalEvent } from "./journal.js";

interface EngineStats {
  engine: string;
  delegations: number;
  successes: number;
  failedChecks: number;
  failedEngines: number;
  timeouts: number;
  successRate: number;
  medianDurationMs: number;
  tokens: number;
  tokenReports: number;
  applications: number;
}

export type StatsWindow = { sinceDays: number; repo: string | null; now: number };

export function eventsInWindow(events: readonly JournalEvent[], { sinceDays, now }: StatsWindow) {
  const cutoff = now - sinceDays * 86_400_000;
  return events.filter(({ ts }) => {
    const time = Date.parse(ts);
    return time >= cutoff && time <= now;
  });
}

export function computeStats(events: readonly JournalEvent[], window: StatsWindow): EngineStats[] {
  const { repo } = window;
  const inWindow = eventsInWindow(events, window);
  const applied = new Set(inWindow.filter(({ type }) => type === "apply").map(({ id }) => id));
  const engines = new Map<string, { row: EngineStats; durations: number[] }>();

  for (const event of inWindow) {
    if (event.type !== "delegation" || (repo !== null && event.repo !== repo)) continue;
    const { engine, id, durationMs, status, tokens } = event;
    let group = engines.get(engine);
    if (!group) {
      group = {
        row: {
          engine,
          delegations: 0,
          successes: 0,
          failedChecks: 0,
          failedEngines: 0,
          timeouts: 0,
          successRate: 0,
          medianDurationMs: 0,
          tokens: 0,
          tokenReports: 0,
          applications: 0,
        },
        durations: [],
      };
      engines.set(engine, group);
    }
    const { row, durations } = group;
    durations.push(durationMs);
    row.delegations++;
    if (status === "success") row.successes++;
    if (status === "check_failed") row.failedChecks++;
    if (status === "engine_failed") row.failedEngines++;
    if (status === "timeout") row.timeouts++;
    if (
      tokens?.input !== undefined ||
      tokens?.output !== undefined ||
      tokens?.cached !== undefined
    ) {
      row.tokens += (tokens.input ?? 0) + (tokens.output ?? 0);
      row.tokenReports++;
    }
    if (applied.has(id)) row.applications++;
  }

  return [...engines.values()]
    .sort((a, b) => a.row.engine.localeCompare(b.row.engine))
    .map(({ row, durations }) => {
      durations.sort((a, b) => a - b);
      const middle = Math.floor(durations.length / 2);
      row.medianDurationMs =
        (durations[Math.floor((durations.length - 1) / 2)] + durations[middle]) / 2;
      row.successRate = row.successes / row.delegations;
      return row;
    });
}

export function engineLabel(engine: string): string {
  const name = engine.replace(/[|\\]/g, "/").replace(/\s+/g, " ").trim();
  return name.length > 64 ? `${name.slice(0, 63)}…` : name;
}

export function renderStats(rows: readonly EngineStats[], malformed: number): string {
  const header =
    "| Engine | Delegations | Successes | Failed checks | Failed engines | Timeouts | Success rate | Median (ms) | Tokens | Token reports | Applied |";
  const table = rows.map((row) => {
    const engine = engineLabel(row.engine);
    return `| ${engine} | ${row.delegations} | ${row.successes} | ${row.failedChecks} | ${row.failedEngines} | ${row.timeouts} | ${(row.successRate * 100).toFixed(1)}% | ${row.medianDurationMs} | ${row.tokens} | ${row.tokenReports} | ${row.applications} |`;
  });
  return [
    ...(rows.length
      ? [header, "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...table]
      : ["No delegations in the selected period and repository."]),
    "",
    `Malformed journal lines ignored: ${malformed}`,
  ].join("\n");
}
