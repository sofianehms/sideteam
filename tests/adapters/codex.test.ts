import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapterNames, allAdapters, getAdapter } from "../../src/adapters/index.js";
import type { Job, RawOutput } from "../../src/adapters/types.js";
import { run } from "../../src/runner.js";

const adapter = getAdapter("codex");
const config = { adapter: "codex" };
const fake = fileURLToPath(new URL("../fixtures/engines/fake-codex.mjs", import.meta.url));
const fixture = (kind: "success" | "failure") =>
  readFile(new URL(`../fixtures/codex/exec-${kind}.jsonl`, import.meta.url), "utf8");

let job: Job;
let baseArgs: string[];
let lastMessage: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sideteam-adapter-"));
  job = {
    id: "job",
    prompt: "Update the project.",
    promptFile: join(dir, "prompt.txt"),
    worktree: dir,
    runDir: dir,
  };
  lastMessage = join(dir, "last-message.txt");
  baseArgs = ["exec", "-s", "workspace-write", "-C", dir, "--json", "-o", lastMessage];
});

afterEach(async () => {
  await rm(job.runDir, { recursive: true, force: true });
});

function raw(stdout: string, code = 0): RawOutput {
  return { code, signal: null, timedOut: false, stdout, stderr: "", runDir: job.runDir };
}

describe("Codex adapter", () => {
  it("builds the exact command for a configured model", () => {
    expect(adapter.buildCommand(job, { ...config, model: "m" })).toMatchObject({
      bin: "codex",
      args: [...baseArgs, "-m", "m", "-"],
      cwd: job.worktree,
      stdin: job.prompt,
    });
  });

  it("omits the model flag when unset", () => {
    expect(adapter.buildCommand(job, config).args).toEqual([...baseArgs, "-"]);
  });

  it("uses the job model when supplied", () => {
    expect(
      adapter.buildCommand({ ...job, model: "override" }, { ...config, model: "m" }).args,
    ).toEqual([...baseArgs, "-m", "override", "-"]);
  });

  it("adds OSS flags and extra arguments before the stdin marker", () => {
    expect(adapter.buildCommand(job, { ...config, options: { oss: true } }).args).toEqual([
      ...baseArgs,
      "--oss",
      "-",
    ]);
    expect(
      adapter.buildCommand(job, {
        ...config,
        options: { oss: true, localProvider: "ollama" },
        args: ["--skip-git-repo-check"],
      }).args,
    ).toEqual([...baseArgs, "--oss", "--local-provider", "ollama", "--skip-git-repo-check", "-"]);
  });

  it("prepends arguments from a binary array", () => {
    expect(adapter.buildCommand(job, { ...config, bin: [process.execPath, fake] })).toMatchObject({
      bin: process.execPath,
      args: [fake, ...baseArgs, "-"],
    });
  });

  it("passes the instruction exclusively on stdin", () => {
    const prompt = "Update the project; rm -rf ~";
    const command = adapter.buildCommand({ ...job, prompt }, config);
    expect(command.args).toEqual([...baseArgs, "-"]);
    expect(command.stdin).toBe(prompt);
  });

  it("reads the output file and sums the fixture usage across turns", async () => {
    await writeFile(lastMessage, "File message.");
    expect(adapter.parseResult(raw(await fixture("success")))).toEqual({
      ok: true,
      message: "File message.",
      tokens: { input: 40, cached: 11, output: 16 },
    });
  });

  it("falls back to the last completed message in stdout", async () => {
    expect(adapter.parseResult(raw(`unknown line\n${await fixture("success")}`)).message).toBe(
      "Finished from stdout.",
    );
  });

  it("returns null tokens when the completed turn has no usage", () => {
    expect(adapter.parseResult(raw('{"type":"turn.completed"}')).tokens).toBeNull();
  });

  it("reports the failed turn and null tokens from the failure fixture", async () => {
    expect(adapter.parseResult(raw(await fixture("failure"), 1))).toEqual({
      ok: false,
      message: "",
      tokens: null,
      error: "Request failed.",
    });
  });

  it("checks the configured binary with its prefix", async () => {
    await expect(adapter.check({ ...config, bin: [process.execPath, fake] })).resolves.toEqual({
      ok: true,
      version: "1.2.3",
    });
    await expect(
      adapter.check({ ...config, bin: join(job.worktree, "missing") }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("detects a binary on the supplied PATH and proposes its configuration", async () => {
    const bin = join(job.worktree, process.platform === "win32" ? "codex.EXE" : "codex");
    await writeFile(bin, "", { mode: 0o755 });
    const probe = vi.fn(async () => ({ code: 0, stdout: "codex-cli 1.2.3\n" }));
    const ctx = { env: { PATH: job.worktree }, platform: process.platform, run: probe };
    await expect(adapter.detect(ctx)).resolves.toEqual({
      found: true,
      bin,
      version: "1.2.3",
      proposal: { name: "codex", config },
    });
    expect(probe).toHaveBeenCalledWith(bin, ["--version"], 15_000);
  });

  it("skips the version probe when the binary is absent", async () => {
    const probe = vi.fn();
    await expect(
      adapter.detect({ env: { PATH: job.worktree }, platform: process.platform, run: probe }),
    ).resolves.toEqual({ found: false });
    expect(probe).not.toHaveBeenCalled();
  });

  it("receives the prompt and returns the final message through the runner", async () => {
    const command = adapter.buildCommand(job, { ...config, bin: [process.execPath, fake] });
    const result = await run(command, { timeoutMs: 5_000, logFile: join(job.runDir, "run.log") });
    expect(await readFile(join(job.worktree, "received-prompt.txt"), "utf8")).toBe(job.prompt);
    expect(adapter.parseResult({ ...result, runDir: job.runDir })).toEqual({
      ok: true,
      message: "Finished from file.",
      tokens: { input: 40, cached: 11, output: 16 },
    });
  });

  it("returns a failed result through the runner", async () => {
    const command = adapter.buildCommand(job, { ...config, bin: [process.execPath, fake] });
    command.env.FAKE_MODE = "fail";
    const result = await run(command, { timeoutMs: 5_000, logFile: join(job.runDir, "run.log") });
    expect(result.code).toBe(1);
    expect(adapter.parseResult({ ...result, runDir: job.runDir })).toMatchObject({
      ok: false,
      error: "Request failed.",
    });
  });
});

it("lists registered adapters and rejects unknown names", () => {
  expect(adapterNames()).toEqual(["codex", "generic"]);
  expect(allAdapters()).toEqual([adapter, getAdapter("generic")]);
  expect(() => getAdapter("toString")).toThrow(/Known adapters: codex, generic/);
});
