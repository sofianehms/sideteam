import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { findOnPath } from "../../src/adapters/bin.js";
import { getAdapter } from "../../src/adapters/index.js";

const adapter = getAdapter("generic");
const config = { adapter: "generic" };
const job = {
  id: "job",
  prompt: "Update the project.",
  promptFile: "runs/job/prompt with spaces.txt",
  worktree: "worktrees/job",
  runDir: "runs/job",
};

it("substitutes all variables without splitting or reprocessing replacements", () => {
  const command = adapter.buildCommand(job, {
    ...config,
    command: ["{cwd}/tool", "--prompt={prompt_file}", "{cwd}:{model}:{model}"],
    model: "$&{cwd}",
  });
  expect(command).toMatchObject({
    bin: "worktrees/job/tool",
    args: ["--prompt=runs/job/prompt with spaces.txt", "worktrees/job:$&{cwd}:$&{cwd}"],
    cwd: job.worktree,
  });
});

it("rejects a model placeholder without a model", () => {
  expect(() => adapter.buildCommand(job, { ...config, command: ["tool", "{model}"] })).toThrow(
    "{model} requires a configured model",
  );
});

it("returns the last 40 stdout lines without tokens", () => {
  const lines = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`);
  expect(
    adapter.parseResult({
      code: 0,
      signal: null,
      timedOut: false,
      stdout: `${lines.join("\r\n")}\r\n`,
      stderr: "Ignored",
      runDir: job.runDir,
    }),
  ).toEqual({ ok: true, message: lines.slice(-40).join("\n"), tokens: null });
});

it("checks a present and an absent binary", async () => {
  await expect(adapter.check({ ...config, command: [process.execPath] })).resolves.toEqual({
    ok: true,
  });
  await expect(
    adapter.check({ ...config, command: ["sideteam-missing-program"] }),
  ).resolves.toMatchObject({ ok: false });
});

it("cannot detect an unspecified tool", async () => {
  const run = vi.fn();
  await expect(adapter.detect({ env: {}, platform: process.platform, run })).resolves.toEqual({
    found: false,
  });
  expect(run).not.toHaveBeenCalled();
});

it("honors PATH and PATHEXT on Windows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sideteam-path-"));
  try {
    const file = join(dir, "engine.CMD");
    await writeFile(file, "");
    expect(findOnPath("engine", { Path: dir, Pathext: ".EXE;.CMD" }, "win32")).toBe(file);
    expect(findOnPath("engine", { Path: dir, Pathext: ".EXE" }, "win32")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
