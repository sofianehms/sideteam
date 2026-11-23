import { appendFile, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { appendEvent, type JournalEvent } from "../src/journal.js";
import { computeStats, renderStats } from "../src/stats.js";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

type Delegation = Extract<JournalEvent, { type: "delegation" }>;

const ts = "2026-11-21T12:00:00.000Z";
const now = Date.parse("2026-11-23T12:00:00.000Z");

function delegation(id: string, overrides: Partial<Delegation> = {}): Delegation {
  return {
    type: "delegation",
    ts,
    id,
    repo: "/project",
    engine: "first",
    adapter: "generic",
    model: null,
    status: "success",
    attempts: 1,
    durationMs: 10,
    files: 1,
    added: 1,
    deleted: 0,
    tokens: null,
    ...overrides,
  };
}

test("aggregates outcomes, median duration, partial tokens, and unique applications", () => {
  const events = [
    delegation("1", { tokens: { input: 10, output: 5, cached: 3 } }),
    delegation("2", { status: "check_failed", durationMs: 30, tokens: { output: 0 } }),
    delegation("3", { status: "engine_failed", durationMs: 15, tokens: { input: 7 } }),
    delegation("4", { status: "timeout", durationMs: 20, tokens: { cached: 4 } }),
    { type: "apply", ts, id: "1" },
    { type: "apply", ts, id: "1" },
    { type: "discard", ts, id: "2" },
    { type: "apply", ts, id: "missing" },
  ] satisfies JournalEvent[];
  expect(computeStats(events, { sinceDays: 30, repo: null, now })).toEqual([
    {
      engine: "first",
      delegations: 4,
      successes: 1,
      failedChecks: 1,
      failedEngines: 1,
      timeouts: 1,
      successRate: 0.25,
      medianDurationMs: 17.5,
      tokens: 22,
      tokenReports: 4,
      applications: 1,
    },
  ]);
});

test("filters by repository and includes the cutoff when filtering by date", () => {
  const events = [
    delegation("1"),
    delegation("2", { ts: "2026-11-21T11:59:59.999Z" }),
    delegation("3", { repo: "/other", engine: "second" }),
    delegation("4", { ts: "2026-11-23T12:00:00.001Z" }),
    { type: "apply", ts, id: "2" },
    { type: "apply", ts, id: "3" },
  ] satisfies JournalEvent[];
  expect(computeStats(events, { sinceDays: 2, repo: "/project", now })).toMatchObject([
    { engine: "first", delegations: 1, medianDurationMs: 10, applications: 0 },
  ]);
  expect(computeStats(events, { sinceDays: 2, repo: null, now })).toMatchObject([
    { engine: "first", delegations: 1, applications: 0 },
    { engine: "second", delegations: 1, applications: 1 },
  ]);
});

test("renders the empty journal and malformed count", () => {
  expect(renderStats(computeStats([], { sinceDays: 30, repo: null, now }), 2)).toBe(
    "No delegations in the selected period and repository.\n\nMalformed journal lines ignored: 2",
  );
});

test("renders five engines under 2,000 characters even with long names", () => {
  const events = Array.from({ length: 5 }, (_, index) =>
    delegation(String(index), { engine: `${index}|\n${"engine".repeat(400)}` }),
  );
  const table = renderStats(computeStats(events, { sinceDays: 30, repo: null, now }), 0);
  expect(table.match(/…/g)).toHaveLength(5);
  expect(table.length).toBeLessThan(2_000);
});

test("reports applied, failed, and discarded runs by engine over stdio", async () => {
  const repo = createTmpRepo();
  const dataDir = join(repo.path, ".sideteam", "data");
  const fixture = fileURLToPath(new URL("./fixtures/engines/fake-engine.mjs", import.meta.url));
  const args = [process.execPath, fixture];
  try {
    await writeFile(
      join(repo.path, ".sideteam.json"),
      JSON.stringify({
        dataDir,
        engines: {
          editor: { adapter: "generic", command: [...args, "edit", "README.md", "Updated\n"] },
          failing: { adapter: "generic", command: [...args, "fail"] },
          spare: { adapter: "generic", command: [...args, "edit", "spare.txt", "Unused\n"] },
        },
        check: [process.execPath, "-e", "process.exit(0)"],
      }),
    );
    const client = await connectMcpClient(repo.path, {
      CLAUDE_PROJECT_DIR: repo.path,
      XDG_CONFIG_HOME: join(repo.path, "config"),
    });
    try {
      const empty = await client.callTool({ name: "stats", arguments: {} });
      expect(empty.content).toEqual([{ type: "text", text: renderStats([], 0) }]);

      const runs = [];
      for (const [engine, status] of [
        ["editor", "success"],
        ["failing", "engine_failed"],
        ["spare", "success"],
      ]) {
        const result = await client.callTool({
          name: "delegate",
          arguments: { prompt: "Update the test project", engine },
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({ engine, status });
        runs.push(result.structuredContent as { id: string; durationMs: number });
      }
      for (const [name, id] of [
        ["apply", runs[0].id],
        ["discard", runs[2].id],
        ["discard", runs[2].id],
      ]) {
        expect((await client.callTool({ name, arguments: { id } })).isError).toBeFalsy();
      }
      const result = await client.callTool({ name: "stats", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([
        {
          type: "text",
          text: [
            "| Engine | Delegations | Successes | Failed checks | Failed engines | Timeouts | Success rate | Median (ms) | Tokens | Token reports | Applied |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            `| editor | 1 | 1 | 0 | 0 | 0 | 100.0% | ${runs[0].durationMs} | 0 | 0 | 1 |`,
            `| failing | 1 | 0 | 0 | 1 | 0 | 0.0% | ${runs[1].durationMs} | 0 | 0 | 0 |`,
            `| spare | 1 | 1 | 0 | 0 | 0 | 100.0% | ${runs[2].durationMs} | 0 | 0 | 0 |`,
            "",
            "Malformed journal lines ignored: 0",
          ].join("\n"),
        },
      ]);
      const journal = (await readFile(join(dataDir, "journal.jsonl"), "utf8")).trim().split("\n");
      expect(journal.map((line) => JSON.parse(line).type)).toEqual([
        "delegation",
        "delegation",
        "delegation",
        "apply",
        "discard",
      ]);

      const day = 86_400_000;
      await appendEvent(
        dataDir,
        delegation("older", {
          engine: "older",
          repo: await realpath(repo.path),
          ts: new Date(Date.now() - 31 * day).toISOString(),
        }),
      );
      await appendEvent(
        dataDir,
        delegation("foreign", { engine: "foreign", ts: new Date().toISOString() }),
      );
      await appendFile(join(dataDir, "journal.jsonl"), "{broken\n");
      const current = await client.callTool({ name: "stats", arguments: {} });
      const all = await client.callTool({ name: "stats", arguments: { repo: "all" } });
      const extended = await client.callTool({ name: "stats", arguments: { sinceDays: 32 } });
      expect(current.content).toEqual([
        { type: "text", text: expect.stringContaining("Malformed journal lines ignored: 1") },
      ]);
      expect(current.content).not.toEqual([
        { type: "text", text: expect.stringMatching(/\| (older|foreign) \|/) },
      ]);
      expect(all.content).toEqual([{ type: "text", text: expect.stringContaining("| foreign |") }]);
      expect(extended.content).toEqual([
        { type: "text", text: expect.stringContaining("| older |") },
      ]);
    } finally {
      await client.close();
    }
  } finally {
    repo.cleanup();
  }
});
