import type { Config } from "./config.js";
import type { JournalEvent } from "./journal.js";
import { engineLabel, eventsInWindow, type StatsWindow } from "./stats.js";
import { readTranscriptCosts } from "./transcripts.js";

function savingsRow() {
  return { measured: 0, total: 0, output: 0, input: 0, engineInput: 0, avoided: 0 };
}

export async function renderSavings(
  events: readonly JournalEvent[],
  window: StatsWindow,
  config: Config["savings"],
): Promise<string> {
  if (!config.enabled) return "Estimated token savings disabled.";
  const ids = new Set(events.filter(({ type }) => type === "delegation").map(({ id }) => id));
  const { costs, readable, malformed } = await readTranscriptCosts(
    config.transcriptsDir,
    window.repo,
    ids,
  );
  if (!readable)
    return "Estimated token savings unavailable: no matching transcripts could be read.";

  const engines = new Map<string, ReturnType<typeof savingsRow>>();
  const total = savingsRow();
  for (const event of eventsInWindow(events, window)) {
    if (event.type !== "delegation" || (window.repo !== null && event.repo !== window.repo))
      continue;
    let row = engines.get(event.engine);
    if (!row) {
      row = savingsRow();
      engines.set(event.engine, row);
    }
    const cost = costs.get(event.id);
    for (const target of [row, total]) {
      target.total++;
      if (!cost?.delegated || cost.incomplete || event.tokens?.output === undefined) continue;
      target.measured++;
      target.output += cost.output;
      target.input += cost.input;
      target.engineInput += event.tokens.input ?? 0;
      target.avoided += event.tokens.output;
    }
  }

  function format(engine: string, row: ReturnType<typeof savingsRow>) {
    const cells = [
      engine,
      `${row.measured} / ${row.total}`,
      row.output,
      row.input,
      row.engineInput,
      row.avoided,
      row.avoided - row.output - row.input,
    ];
    return `| ${cells.join(" | ")} |`;
  }

  return [
    "Estimated Claude token savings",
    "",
    "| Engine | Measured / Total | Claude output | Claude input | Engine input (reported) | Work avoided | Estimated savings |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...[...engines]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([engine, row]) => format(engineLabel(engine), row)),
    format("**Total**", total),
    "",
    `Malformed or unknown transcript lines ignored: ${malformed}`,
  ].join("\n");
}
