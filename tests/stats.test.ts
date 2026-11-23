import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { appendEvent, type JournalEvent } from "../src/journal.js";
import { renderSavings } from "../src/savings.js";
import { computeStats, renderStats } from "../src/stats.js";
import { readTranscriptCosts } from "../src/transcripts.js";
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
        savings: { enabled: false },
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
      expect(empty.content).toEqual([
        { type: "text", text: `${renderStats([], 0)}\n\nEstimated token savings disabled.` },
      ]);

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
            "",
            "Estimated token savings disabled.",
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

async function writeTranscript(directory: string, fixture: string, cwd: string) {
  const file = new URL(`./fixtures/transcripts/${fixture}.jsonl`, import.meta.url);
  const dir = join(directory, cwd.replace(/[^a-zA-Z0-9-]/g, "-"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${fixture}.jsonl`),
    (await readFile(file, "utf8")).replaceAll("PROJECT_CWD", JSON.stringify(cwd).slice(1, -1)),
  );
}

test("reads transcript costs for applied, retried, discarded, and parallel runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sideteam-transcript-"));
  try {
    const repo = await realpath(directory);
    const other = join(repo, "other");
    await writeTranscript(directory, "current", repo);
    await writeTranscript(directory, "foreign", other);
    const ids = new Set(["applied", "retried", "discarded", "unmatched", "f-one", "f-two"]);
    const current = await readTranscriptCosts(directory, repo, ids);
    expect(current).toMatchObject({ readable: 1, malformed: 3 });
    expect([...current.costs]).toEqual([
      ["applied", { delegated: true, incomplete: false, input: 20, output: 13 }],
      ["retried", { delegated: true, incomplete: false, input: 10, output: 10 }],
      ["discarded", { delegated: true, incomplete: false, input: 15, output: 13 }],
    ]);
    const all = await readTranscriptCosts(directory, null, ids);
    expect(all).toMatchObject({ readable: 2, malformed: 3 });
    expect(all.costs.get("f-one")).toMatchObject({ input: 6, output: 3 });
    expect(all.costs.get("f-two")).toMatchObject({ input: 6, output: 2 });
    const savings = await renderSavings(
      [
        delegation("applied", { repo, tokens: { output: 100, input: 40 } }),
        delegation("unknown", { repo, tokens: { input: 10 } }),
        delegation("unmatched", { repo, tokens: { output: 10 } }),
      ],
      { now, sinceDays: 30, repo },
      { enabled: true, transcriptsDir: directory },
    );
    expect(savings).toContain("| **Total** | 1 / 3 | 13 | 20 | 40 | 100 | 67 |");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("estimates savings from fixture transcripts and keeps transcript text out of results and data", async () => {
  const repository = createTmpRepo();
  const path = await realpath(repository.path);
  const dataDir = join(path, "data");
  const transcriptsDir = join(path, "projects");
  const configPath = join(path, ".sideteam.json");
  const other = join(path, "other");
  async function configure(directory: string) {
    await writeFile(
      configPath,
      JSON.stringify({ dataDir, savings: { transcriptsDir: directory } }),
    );
  }

  try {
    await configure(transcriptsDir);
    await writeTranscript(transcriptsDir, "current", path);
    await writeTranscript(transcriptsDir, "foreign", other);
    const currentProject = join(transcriptsDir, path.replace(/[^a-zA-Z0-9-]/g, "-"));
    await writeFile(
      join(currentProject, "different-cwd.jsonl"),
      `${JSON.stringify({ type: "unknown-type", cwd: other })}\n`,
    );
    const time = new Date().toISOString();
    for (const [id, overrides] of [
      ["applied", { tokens: { output: 100, input: 40 } }],
      ["retried", { attempts: 2, tokens: { output: 60, input: 10 } }],
      ["discarded", { engine: "second", status: "check_failed", tokens: { output: 10 } }],
      ["unknown", { tokens: { input: 10 } }],
      ["unmatched", { tokens: { output: 10 } }],
      ["old", { ts: new Date(Date.now() - 31 * 86_400_000).toISOString() }],
      ["f-one", { repo: other, engine: "third", tokens: { output: 30 } }],
      ["f-two", { repo: other, engine: "third", tokens: { output: 0 } }],
    ] satisfies [string, Partial<Delegation>][]) {
      await appendEvent(dataDir, delegation(id, { repo: path, ts: time, ...overrides }));
    }
    await appendEvent(dataDir, { type: "apply", id: "applied", ts: time });
    await appendEvent(dataDir, { type: "discard", id: "discarded", ts: time });
    const journal = await readFile(join(dataDir, "journal.jsonl"), "utf8");

    const client = await connectMcpClient(path, {
      CLAUDE_PROJECT_DIR: path,
      XDG_CONFIG_HOME: join(path, "config"),
    });
    try {
      async function stats(args = {}) {
        const result = await client.callTool({ name: "stats", arguments: args });
        expect(result.isError).toBeFalsy();
        expect(result.content).toMatchObject([{ type: "text", text: expect.any(String) }]);
        const [{ text }] = result.content as { text: string }[];
        expect(text).not.toContain("PRIVATE_TRANSCRIPT_MARKER");
        return text;
      }
      const current = await stats();
      expect(current).toContain("| first | 2 / 4 | 23 | 30 | 50 | 160 | 107 |");
      expect(current).toContain("| second | 1 / 1 | 13 | 15 | 0 | 10 | -18 |");
      expect(current).toContain("| **Total** | 3 / 5 | 36 | 45 | 50 | 170 | 89 |");
      expect(current).toContain("Malformed or unknown transcript lines ignored: 3");
      expect(current).not.toContain("| third |");

      const all = await stats({ repo: "all" });
      expect(all).toContain("Malformed or unknown transcript lines ignored: 4");
      expect(all).toContain("| third | 2 / 2 | 5 | 12 | 0 | 30 | 13 |");
      expect(all).toContain("| **Total** | 5 / 7 | 41 | 57 | 50 | 200 | 102 |");

      for (const directory of [join(path, "missing"), configPath]) {
        await configure(directory);
        expect(await stats()).toBe(
          current.split("\n\nEstimated Claude token savings")[0] +
            "\n\nEstimated token savings unavailable: no matching transcripts could be read.",
        );
      }
    } finally {
      await client.close();
    }
    expect(await readdir(dataDir)).toEqual(["journal.jsonl"]);
    expect(await readFile(join(dataDir, "journal.jsonl"), "utf8")).toBe(journal);
    expect(journal).not.toContain("PRIVATE_TRANSCRIPT_MARKER");
  } finally {
    repository.cleanup();
  }
});
