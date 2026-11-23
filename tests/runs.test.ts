import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createRunDir, type RunMeta, readMeta, writeMeta } from "../src/runs.js";

let dataDir: string;
const artifacts = ["check.log", "engine.log", "prompt.md", "setup.log"];
const meta: RunMeta = {
  id: "abc123",
  repo: "/repo",
  base: "dev",
  branch: "sideteam/abc123",
  worktree: "/worktree",
  links: ["node_modules"],
  engine: "local",
  adapter: "generic",
  model: null,
  status: "success",
  reason: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  durationMs: 250,
  tokens: { input: 100, output: 25 },
  files: [{ path: "src/index.ts", added: 3, deleted: 1 }],
  check: { command: "npm test", code: 0 },
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "sideteam-runs-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("creates the run directory under the data directory", async () => {
  const directory = await createRunDir(dataDir, meta.id);
  expect(directory).toBe(join(dataDir, "runs", meta.id));
  expect((await stat(directory)).isDirectory()).toBe(true);
  expect((await readdir(directory)).sort()).toEqual(artifacts);
  const prompt = join(directory, "prompt.md");
  await writeFile(prompt, "Existing instruction");
  await createRunDir(dataDir, meta.id);
  expect(await readFile(prompt, "utf8")).toBe("Existing instruction");
});

test("writes and reads only the metadata schema", async () => {
  const directory = await createRunDir(dataDir, meta.id);
  const input = { ...meta, env: { SAMPLE: "example" }, prompt: "Full instruction" };
  await writeMeta(dataDir, input);
  expect(await readMeta(dataDir, meta.id)).toEqual(meta);
  const saved = JSON.parse(await readFile(join(directory, "meta.json"), "utf8"));
  expect(Object.keys(saved).sort()).toEqual(
    [
      "adapter",
      "base",
      "branch",
      "check",
      "durationMs",
      "engine",
      "files",
      "id",
      "links",
      "model",
      "reason",
      "repo",
      "startedAt",
      "status",
      "tokens",
      "worktree",
    ].sort(),
  );
});

test("replaces metadata without leaving temporary files", async () => {
  const directory = await createRunDir(dataDir, meta.id);
  await writeMeta(dataDir, meta);
  await Promise.all([
    writeMeta(dataDir, { ...meta, durationMs: 300 }),
    writeMeta(dataDir, { ...meta, durationMs: 400 }),
  ]);
  expect([300, 400]).toContain((await readMeta(dataDir, meta.id)).durationMs);
  expect((await readdir(directory)).sort()).toEqual([...artifacts, "meta.json"].sort());
});

test("removes the temporary file when replacement fails", async () => {
  const directory = await createRunDir(dataDir, meta.id);
  await mkdir(join(directory, "meta.json"));
  await expect(writeMeta(dataDir, meta)).rejects.toThrow();
  expect((await readdir(directory)).sort()).toEqual([...artifacts, "meta.json"].sort());
});

test("reports unknown identifiers when metadata is missing", async () => {
  await expect(readMeta(dataDir, "missing")).rejects.toThrow("unknown delegation missing");
  await createRunDir(dataDir, meta.id);
  await expect(readMeta(dataDir, meta.id)).rejects.toThrow("unknown delegation abc123");
});
