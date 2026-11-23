import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

const fixture = fileURLToPath(new URL("./fixtures/engines/fake-engine.mjs", import.meta.url));
const engine = (...args: string[]) => ({
  adapter: "generic",
  command: [process.execPath, fixture, ...args],
  env: ["FAKE_STATE"],
});

const wrong = engine("edit", "abandoned.txt", "wrong");
const right = engine("edit", "answer.txt", "ready");
const fail = engine("fail");
const prompt = "Finish the requested edit.";
const cap = 650;
let repo: ReturnType<typeof createTmpRepo>;

beforeEach(() => {
  repo = createTmpRepo();
});
afterEach(() => {
  repo.cleanup();
});

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo.path, encoding: "utf8" });

async function delegate(first: typeof wrong, local = right, fallback?: boolean) {
  const dataDir = join(repo.path, ".sideteam", "data");
  const state = join(repo.path, ".sideteam", "counter");
  await writeFile(
    join(repo.path, "verify.mjs"),
    `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
const root = ${JSON.stringify(repo.path)};
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
assert.equal(git("branch", "--show-current").trim(), "main");
assert.equal(git("status", "--porcelain"), " M README.md\\n");
assert.equal(readFileSync(root + "/README.md", "utf8"), "local edit\\n");
assert.equal(existsSync("answer.txt") && readFileSync("answer.txt", "utf8"), "ready", "expected a ready answer");
`,
  );
  await writeFile(
    join(repo.path, ".sideteam.json"),
    JSON.stringify({
      dataDir,
      default: "codex",
      fallback: ["codex", "local", "local"],
      engines: { codex: first, local },
      check: [process.execPath, "verify.mjs"],
      limits: { maxSummaryChars: cap },
    }),
  );
  git("add", ".");
  git("commit", "-m", "Configure delegation");
  const base = git("rev-parse", "HEAD").trim();
  await writeFile(join(repo.path, "README.md"), "local edit\n");
  const client = await connectMcpClient(dirname(repo.path), {
    CLAUDE_PROJECT_DIR: repo.path,
    XDG_CONFIG_HOME: join(repo.path, "config"),
    FAKE_STATE: state,
  });
  try {
    const result = await client.callTool({ name: "delegate", arguments: { prompt, fallback } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const { id, status } = result.structuredContent as { id: string; status: string };
    const text = (result.content as { text: string }[])[0].text;
    expect(text.length).toBeLessThanOrEqual(cap);
    expect(git("rev-parse", "HEAD").trim()).toBe(base);
    expect(git("branch", "--show-current").trim()).toBe("main");
    expect(git("status", "--porcelain")).toBe(" M README.md\n");
    expect(await readFile(join(repo.path, "README.md"), "utf8")).toBe("local edit\n");
    const directory = join(dataDir, "runs", id);
    const read = (...parts: string[]) => readFile(join(directory, ...parts), "utf8");
    const meta = JSON.parse(await read("meta.json"));
    expect(meta).toMatchObject({ id, base, branch: `sideteam/${id}`, status });
    return { text, status, meta, directory, read, base, state };
  } finally {
    await client.close();
  }
}

async function expectAttempts(
  result: Awaited<ReturnType<typeof delegate>>,
  expected: [string, number, string][],
) {
  const entries = expected.map(([engine, attempt, status]) => ({ engine, attempt, status }));
  expect(result.text.split("\n")).toContain(
    `Attempts: ${entries.map(({ engine, attempt, status }) => `${engine}#${attempt} ${status}`).join(", ")}`,
  );
  expect(result.meta.attempts).toEqual(
    entries.map((entry) => ({
      ...entry,
      durationMs: expect.any(Number),
      reason: entry.status === "engine_failed" ? "Fixture failed" : null,
      tokens: null,
    })),
  );
  const folders = entries.map((_, index) => `attempt-${index + 1}`);
  expect((await readdir(result.directory)).filter((name) => name.startsWith("attempt-"))).toEqual(
    folders,
  );
  for (const folder of folders) {
    expect((await readdir(join(result.directory, folder))).sort()).toEqual([
      "check.log",
      "engine.log",
      "prompt.md",
      "setup.log",
    ]);
  }
}

test("retries a failed check in the same worktree and succeeds on the second attempt", async () => {
  const result = await delegate(engine("edit-on-2nd", "answer.txt", "ready"));
  expect(result.status).toBe("success");
  await expectAttempts(result, [
    ["codex", 1, "check_failed"],
    ["codex", 2, "success"],
  ]);
  expect(await readFile(result.state, "utf8")).toBe("2");
  const original = await result.read("attempt-1", "prompt.md");
  const retried = await result.read("attempt-2", "prompt.md");
  expect(retried.startsWith(original)).toBe(true);
  expect(retried).toContain("expected a ready answer");
  expect(retried).toContain("Fix the failing check.");
  expect(await result.read("attempt-1", "check.log")).toContain("expected a ready answer");
});

test("falls back after two check failures and keeps earlier changes out of the final diff", async () => {
  const result = await delegate(wrong);
  expect(result.status).toBe("success");
  await expectAttempts(result, [
    ["codex", 1, "check_failed"],
    ["codex", 2, "check_failed"],
    ["local", 1, "success"],
  ]);
  expect(await result.read("attempt-3", "prompt.md")).toBe(
    await result.read("attempt-1", "prompt.md"),
  );
  expect(git("diff", "--name-only", `${result.base}..${result.meta.branch}`).trim()).toBe(
    "answer.txt",
  );
  expect(git("rev-parse", `${result.meta.branch}^`).trim()).toBe(result.base);
});

test("skips retries on engine failure", async () => {
  const result = await delegate(fail);
  expect(result.status).toBe("success");
  await expectAttempts(result, [
    ["codex", 1, "engine_failed"],
    ["local", 1, "success"],
  ]);
  expect(await result.read("attempt-1", "engine.log")).toContain("Fixture failed");
});

test("reports the last status and concludes when all engines fail", async () => {
  const result = await delegate(wrong, fail);
  expect(result.status).toBe("engine_failed");
  await expectAttempts(result, [
    ["codex", 1, "check_failed"],
    ["codex", 2, "check_failed"],
    ["local", 1, "engine_failed"],
  ]);
  expect(result.text.endsWith("all engines failed; consider doing this task directly")).toBe(true);
});

test("disables fallback for a call while still retrying the selected engine", async () => {
  const result = await delegate(wrong, right, false);
  expect(result.status).toBe("check_failed");
  await expectAttempts(result, [
    ["codex", 1, "check_failed"],
    ["codex", 2, "check_failed"],
  ]);
});
