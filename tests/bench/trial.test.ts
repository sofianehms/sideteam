import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { copyPlugin } from "../../bench/lib/plugin-copy.js";
import { readTrials } from "../../bench/lib/results.js";
import { planSeries } from "../../bench/lib/series.js";
import { loadTasks } from "../../bench/lib/tasks.js";
import { runTrial } from "../../bench/lib/trial.js";

const fixture = resolve("tests/fixtures/bench");
const claudeBin = join(fixture, "fake-claude.mjs");
const tasks = loadTasks(join(fixture, "tasks"));
let scratch: string;
let options: { scratch: string; claudeBin: string; claudeVersion: string; timeoutMs: number };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "sideteam-trial-test-"));
  options = { scratch, claudeBin, claudeVersion: "1.2.3", timeoutMs: 3000 };
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

test("hidden tests distinguish a solved trial from an unchanged trial and record usage", async () => {
  const [trial] = planSeries(tasks, "light", []);
  vi.stubEnv("FAKE_CLAUDE", "solve");
  vi.stubEnv("FAKE_CLAUDE_SOLUTION", join(trial.task.directory, "solution"));
  await expect(runTrial(trial, options)).resolves.toMatchObject({
    success: true,
    timeout: false,
    claudeTokens: { input: 30, output: 20, cacheCreation: 10, cacheRead: 40 },
    claudeCost: 0.03,
    versions: { claude: "1.2.3" },
    models: { claude: ["claude-test"] },
  });
  vi.stubEnv("FAKE_CLAUDE", "noop");
  await expect(runTrial(trial, options)).resolves.toMatchObject({ success: false, timeout: false });
});

test("a timeout counts as a failed trial", async () => {
  vi.stubEnv("FAKE_CLAUDE", "hang");
  const [trial] = planSeries(tasks, "light", []);
  await expect(runTrial(trial, { ...options, timeoutMs: 200 })).resolves.toMatchObject({
    success: false,
    timeout: true,
  });
});

function benchmarkRoot() {
  const root = join(scratch, "project");
  const bench = join(root, "bench");
  mkdirSync(bench, { recursive: true });
  cpSync(join(fixture, "tasks"), join(bench, "tasks"), { recursive: true });
  writeFileSync(
    join(bench, "engines.json"),
    JSON.stringify({
      metered: { adapter: "codex", bin: claudeBin, pricePerMTok: { input: 2, output: 4 } },
      offline: { adapter: "codex", bin: join(root, "missing") },
    }),
  );
  for (const name of [".claude-plugin", "skills", "commands"]) mkdirSync(join(root, name));
  writeFileSync(join(root, ".mcp.json"), "{}");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      scripts: { build: "node -e \"require('node:fs').mkdirSync('dist', { recursive: true })\"" },
    }),
  );
  return root;
}

async function compileCli(root: string) {
  const outfile = join(root, "run.mjs");
  await build({
    entryPoints: [resolve("bench/run.ts")],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
  });
  // macOS temporary directory paths can also reach the bundled entry point through a symlink.
  const alias = join(scratch, "project-link");
  symlinkSync(root, alias, "junction");
  return join(alias, "run.mjs");
}

test("quota at trial three exits 75 and resumption retries it without duplicates", async () => {
  const root = benchmarkRoot();
  const out = join(root, "bench", "results", "light");
  const counter = join(scratch, "calls");
  const cli = await compileCli(root);
  vi.stubEnv("SIDETEAM_BENCH_CLAUDE_BIN", claudeBin);
  vi.stubEnv("FAKE_CLAUDE_COUNTER", counter);
  vi.stubEnv("FAKE_CLAUDE", "quota");
  const args = [cli, "--engines", "metered,offline"];
  const first = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  expect(first.status, first.stderr).toBe(75);
  expect(first.stdout).toContain('Skipping engine "offline":');
  expect(first.stdout).toContain(
    "Quota reached after 2/4 trials; rerun the same command later to resume.",
  );
  const journal = join(out, "trials.jsonl");
  const firstLines = readFileSync(journal, "utf8").trimEnd().split("\n");
  expect(firstLines).toHaveLength(2);
  expect(JSON.parse(readFileSync(join(out, "state.json"), "utf8"))).toMatchObject({
    stoppedAt: expect.any(String),
    reason: "Usage limit",
  });

  vi.stubEnv("FAKE_CLAUDE", "meta");
  const resumed = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  expect(resumed.status, resumed.stderr).toBe(0);
  expect(resumed.stdout).toContain("skipping 2 completed trials");
  expect(readFileSync(counter, "utf8")).toBe("5");
  const lines = readFileSync(journal, "utf8").trimEnd().split("\n");
  expect(lines.slice(0, 2)).toEqual(firstLines);
  expect(lines).toHaveLength(4);
  expect(new Set(lines.map((line) => JSON.parse(line).key)).size).toBe(4);
  const [, , third, fourth] = readTrials(out);
  expect(third.key).toBe("02-ts-increment|A||1");
  expect(fourth).toMatchObject({
    key: "02-ts-increment|B|metered|1",
    delegations: 1,
    engineTokens: { input: 200, output: 50, cached: 10 },
    engineCost: 0.0006,
    versions: { engine: "1.2.3" },
    models: { engine: ["engine-test"] },
  });
});

test("SIGINT stops the active trial without recording it", async () => {
  const root = benchmarkRoot();
  const cli = await compileCli(root);
  const counter = join(scratch, "calls");
  vi.stubEnv("SIDETEAM_BENCH_CLAUDE_BIN", claudeBin);
  vi.stubEnv("FAKE_CLAUDE", "hang");
  vi.stubEnv("FAKE_CLAUDE_COUNTER", counter);
  const child = spawn(process.execPath, [cli, "--engines", "offline"], {
    cwd: root,
    stdio: "ignore",
  });
  const closed = once(child, "close");
  try {
    await vi.waitFor(() => expect(existsSync(counter)).toBe(true), { timeout: 8000 });
    child.kill("SIGINT");
    expect(await closed).toEqual([130, null]);
    expect(readTrials(join(root, "bench", "results", "light"))).toEqual([]);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await closed;
  }
});

test("the built plugin copy contains only the runtime allowlist", async () => {
  const root = join(scratch, "project");
  mkdirSync(root);
  for (const path of [
    "src",
    "scripts",
    ".claude-plugin",
    ".mcp.json",
    "skills",
    "commands",
    "package.json",
  ]) {
    cpSync(resolve(path), join(root, path), { recursive: true });
  }
  for (const path of ["bench", "tests"]) mkdirSync(join(root, path));
  symlinkSync(resolve("node_modules"), join(root, "node_modules"), "junction");
  const plugin = await copyPlugin(root, scratch);
  expect(readdirSync(plugin).sort()).toEqual(
    [".claude-plugin", ".mcp.json", "commands", "dist", "package.json", "skills"].sort(),
  );
  expect(readdirSync(join(plugin, "dist"))).toContain("sideteam.js");
});
