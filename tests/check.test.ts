import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { parseCommand, runCommandIn } from "../src/check.js";

let cwd: string;
let logFile: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "sideteam-check-"));
  logFile = join(cwd, "check.log");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(cwd, { recursive: true, force: true });
});

test("splits program and arguments with single and double quotes and no expansion", () => {
  expect(parseCommand('node -e "process.exit(0)"')).toEqual(["node", "-e", "process.exit(0)"]);
  expect(parseCommand(` node  'two words' "" $HOME *.ts ab"cd" `)).toEqual([
    "node",
    "two words",
    "",
    "$HOME",
    "*.ts",
    "abcd",
  ]);
  expect(() => parseCommand(`node "unfinished`)).toThrow("command contains an unterminated quote");
});

test("rejects shell operators in strings and preserves literal array arguments", () => {
  const message = "command must be a single program; wrap it in a package script";
  expect(() => parseCommand("npm test && rm -rf /")).toThrow(message);
  for (const operator of ["&&", "||", "|", ";", ">", "<"]) {
    expect(() => parseCommand(`node ${operator} test`)).toThrow(message);
  }
  const args = ["node", ";", "a b"];
  expect(parseCommand(args)).toBe(args);
});

test("runs a successful command with the project environment", async () => {
  vi.stubEnv("SIDETEAM_CHECK_TEST", "present");
  const result = await runCommandIn(
    cwd,
    [process.execPath, "-e", "console.log(process.env.SIDETEAM_CHECK_TEST)"],
    { timeoutMs: 3000, logFile, lines: 1 },
  );
  expect(result).toMatchObject({ passed: true, code: 0, timedOut: false, tail: ["present"] });
});

test("returns only the requested final lines of the combined log on failure", async () => {
  const result = await runCommandIn(
    cwd,
    [
      process.execPath,
      "-e",
      String.raw`process.stdout.write('first\nsecond\n', () => {
        setTimeout(() => {
          process.stderr.write('third\nfourth');
          process.exitCode = 3;
        }, 100);
      });`,
    ],
    { timeoutMs: 3000, logFile, lines: 3 },
  );
  expect(result).toMatchObject({
    passed: false,
    code: 3,
    timedOut: false,
    tail: ["second", "third", "fourth"],
  });
});

test("fails a command that exceeds its timeout", async () => {
  const result = await runCommandIn(cwd, [process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    timeoutMs: 300,
    logFile,
    lines: 2,
  });
  expect(result).toMatchObject({ passed: false, timedOut: true, tail: [] });
});
