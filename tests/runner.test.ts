import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { buildEngineEnv } from "../src/env.js";
import { run } from "../src/runner.js";

const fixture = fileURLToPath(new URL("./fixtures/engines/fake-engine.mjs", import.meta.url));
const windows = process.platform === "win32";
let cwd: string;
let logFile: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "sideteam-runner-"));
  logFile = join(cwd, "logs", "run.log");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function runFixture(
  mode: string,
  options: Partial<Parameters<typeof run>[1]> = {},
  env: Record<string, string> = {},
  stdin?: string,
) {
  return run(
    { bin: process.execPath, args: [fixture], cwd, env: { ...env, FAKE_MODE: mode }, stdin },
    { timeoutMs: 3000, logFile, ...options },
  );
}

test("runs a successful program in the requested directory", async () => {
  const result = await runFixture("edit", {}, { FAKE_FILE: "edited.txt", FAKE_CONTENT: "edited" });
  expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stdoutTruncated: false });
  expect(await readFile(join(cwd, "edited.txt"), "utf8")).toBe("edited");
  expect(await readFile(logFile, "utf8")).toBe("");
});

test("returns the failure code and logs stderr", async () => {
  const result = await runFixture("fail");
  expect(result).toMatchObject({ code: 3, stderr: "Fixture failed\n", timedOut: false });
  expect(await readFile(logFile, "utf8")).toBe(result.stderr);
});

test("returns an error for a missing binary", async () => {
  const bin = join(cwd, "missing");
  const result = await run({ bin, args: [], cwd, env: {} }, { timeoutMs: 1000, logFile });
  expect(result).toMatchObject({ spawnError: `not found: ${bin}`, timedOut: false });
});

test("times out and reports progress until the process closes", async () => {
  const progress: number[] = [];
  const result = await runFixture("hang", {
    timeoutMs: 450,
    progressIntervalMs: 50,
    onProgress: (elapsed) => progress.push(elapsed),
  });
  expect(result.timedOut).toBe(true);
  if (!windows) expect(result.signal).toBe("SIGTERM");
  expect(progress.length).toBeGreaterThanOrEqual(3);
  expect(progress.at(-1)).toBeGreaterThanOrEqual(200);
  const calls = progress.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(progress).toHaveLength(calls);
});

test.skipIf(windows)("escalates to SIGKILL less than seven seconds after timeout", async () => {
  const timeoutMs = 500;
  const result = await runFixture("hang-hard", { timeoutMs });
  expect(result).toMatchObject({ signal: "SIGKILL", timedOut: true });
  expect(result.durationMs - timeoutMs).toBeGreaterThanOrEqual(4900);
  expect(result.durationMs - timeoutMs).toBeLessThan(7000);
});

test.skipIf(windows)("stops and reaps the grandchild on timeout", async () => {
  const result = await runFixture("child", { timeoutMs: 500 });
  expect(result.timedOut).toBe(true);
  const pid = Number(result.stdout.trim());
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
});

test("caps captured stdout and preserves the complete raw log", async () => {
  const result = await runFixture("flood");
  expect(result).toMatchObject({ code: 0, stdoutTruncated: true });
  expect(result.stdout).toHaveLength(10 * 1024 * 1024);
  expect((await stat(logFile)).size).toBe(20 * 1024 * 1024);
  expect((await readFile(logFile)).equals(Buffer.alloc(20 * 1024 * 1024, "x"))).toBe(true);
});

test("keeps only the last 64 KB of stderr", async () => {
  const result = await run(
    {
      bin: process.execPath,
      args: ["-e", "process.stderr.write('a'.repeat(65536) + 'end')"],
      cwd,
      env: {},
    },
    { timeoutMs: 3000, logFile },
  );
  expect(result.stderr).toBe(`${"a".repeat(65533)}end`);
  expect((await stat(logFile)).size).toBe(65539);
});

test("writes stdin and closes it", async () => {
  const input = "instructions\nwith Unicode: café\n";
  const result = await runFixture("stdin", {}, { FAKE_FILE: "stdin.txt" }, input);
  expect(result.code).toBe(0);
  expect(await readFile(join(cwd, "stdin.txt"), "utf8")).toBe(input);
  const empty = await runFixture("stdin", {}, { FAKE_FILE: "stdin.txt" });
  expect(empty.code).toBe(0);
  expect(await readFile(join(cwd, "stdin.txt"), "utf8")).toBe("");
});

test("passes only allowed names and keeps the test value out of the raw log", async () => {
  const name = "SIDETEAM_TEST_SECRET";
  const value = "fixture-value";
  const source = { [name]: value, PATH: cwd, NO_COLOR: "0" };
  for (const pass of [[], [name]]) {
    const env = buildEngineEnv(pass, source);
    expect(env.NO_COLOR).toBe("1");
    const result = await runFixture("env", {}, env);
    expect(result.code).toBe(0);
    const names = result.stdout.trim().split("\n");
    expect(names.includes(name)).toBe(pass.includes(name));
    expect(names).toContain("PATH");
    expect(names).toContain("NO_COLOR");
    expect(await readFile(logFile, "utf8")).not.toContain(value);
  }
});

test("matches Windows environment names case-insensitively", () => {
  const source = {
    Path: "path",
    SYSTEMROOT: "root",
    extra: "extra",
    no_color: "0",
    other: "other",
  };
  expect(buildEngineEnv(["EXTRA"], source, "win32")).toEqual({
    Path: "path",
    SYSTEMROOT: "root",
    extra: "extra",
    NO_COLOR: "1",
  });
});
