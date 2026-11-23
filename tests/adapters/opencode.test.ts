import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getAdapter } from "../../src/adapters/index.js";
import type { Job, RawOutput } from "../../src/adapters/types.js";
import { run } from "../../src/runner.js";
import { connectMcpClient } from "../helpers/mcp-client.js";
import { createTmpRepo } from "../helpers/tmp-repo.js";

const adapter = getAdapter("opencode");
const config = { adapter: "opencode", model: "ollama/qwen3-coder:30b" };
const bin = [
  process.execPath,
  fileURLToPath(new URL("../fixtures/engines/fake-opencode.mjs", import.meta.url)),
];
const fixture = (kind: "success" | "error") =>
  readFile(new URL(`../fixtures/opencode/run-${kind}.jsonl`, import.meta.url), "utf8");
let job: Job;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sideteam-opencode-"));
  job = {
    id: "job",
    prompt: "Update the file.",
    promptFile: join(dir, "prompt.md"),
    worktree: dir,
    runDir: dir,
  };
});

afterEach(async () => {
  await rm(job.runDir, { recursive: true, force: true });
});

function raw(stdout: string, code: number | null = 0): RawOutput {
  return { code, signal: null, timedOut: false, stdout, stderr: "", runDir: job.runDir };
}

test("builds the exact command and sends the prompt on standard input", () => {
  const args = ["run", "-m", config.model, "--format", "json", "--dir", job.worktree, "--auto"];
  expect(adapter.buildCommand(job, config)).toMatchObject({
    bin: "opencode",
    args,
    cwd: job.worktree,
    stdin: job.prompt,
  });
  const command = adapter.buildCommand(
    { ...job, model: "ollama/devstral-small", prompt: "--help" },
    {
      ...config,
      bin,
      args: ["--title", "Review"],
    },
  );
  args[2] = "ollama/devstral-small";
  expect(command.args).toEqual([bin[1], ...args, "--title", "Review"]);
  expect(command.stdin).toBe("--help");
  expect(Object.keys(command.env).filter((key) => /^OPENCODE_/i.test(key))).toEqual([]);
});

test.each([
  undefined,
  "",
  "qwen3-coder",
  "/qwen3-coder",
  "ollama/",
])("rejects invalid model %j", (model) => {
  expect(() => adapter.buildCommand(job, { ...config, model })).toThrow(
    "opencode engine requires model as provider/model",
  );
});

test("keeps long prompts out of the arguments", () => {
  const prompt = "x".repeat(40_000);
  const command = adapter.buildCommand({ ...job, prompt }, config);
  expect(command.stdin).toBe(prompt);
  expect(command.args).not.toContain(prompt);
});

test("reads the last step's text parts and sums token counts", async () => {
  expect(
    adapter.parseResult(raw(`unstructured line\r\nnull\r\n${await fixture("success")}`)),
  ).toEqual({
    ok: true,
    message: "DONE",
    tokens: { input: 11782, output: 36, cached: 11264 },
  });
});

test("accepts partial or absent usage", () => {
  expect(
    adapter.parseResult(
      raw('{"type":"step_finish","part":{"tokens":{"input":"unknown","output":2}}}'),
    ).tokens,
  ).toEqual({ output: 2 });
  expect(adapter.parseResult(raw('{"type":"step_finish"}')).tokens).toBeNull();
});

test.each([0, 1])("reports a structured error with exit code %i", async (code) => {
  expect(adapter.parseResult(raw(await fixture("error"), code))).toEqual({
    ok: false,
    message: "",
    tokens: null,
    error: "Unexpected server error. Check server logs for details.",
  });
});

test("reports unstructured errors and process failures", () => {
  expect(adapter.parseResult(raw('{"type":"error"}')).error).toBe("OpenCode reported an error");
  expect(adapter.parseResult({ ...raw("", 2), stderr: " failed\n" }).error).toBe("failed");
  expect(adapter.parseResult({ ...raw(""), timedOut: true }).error).toBe("Engine timed out");
  expect(adapter.parseResult({ ...raw("", null), signal: "SIGTERM" }).error).toBe(
    "Engine exited with SIGTERM",
  );
  expect(adapter.parseResult({ ...raw(""), spawnError: "not found" }).error).toBe("not found");
});

test("checks the configured executable", async () => {
  await expect(adapter.check({ ...config, bin })).resolves.toEqual({ ok: true, version: "1.2.3" });
  await expect(
    adapter.check({ ...config, bin: join(job.worktree, "missing") }),
  ).resolves.toMatchObject({ ok: false });
});

async function executable(name: string) {
  const path = join(job.worktree, process.platform === "win32" ? `${name}.EXE` : name);
  await writeFile(path, "", { mode: 0o755 });
  return path;
}

test("detects OpenCode alone without proposing an incomplete engine", async () => {
  const probe = vi.fn(async () => ({ code: 0, stdout: "1.2.3\n" }));
  const ctx = { env: { PATH: job.worktree }, platform: process.platform, run: probe };
  await expect(adapter.detect(ctx)).resolves.toEqual({ found: false });
  const openCode = await executable("opencode");
  await expect(adapter.detect(ctx)).resolves.toEqual({
    found: true,
    bin: openCode,
    version: "1.2.3",
  });
  expect(probe.mock.calls).toEqual([[openCode, ["--version"], 15_000]]);
});

test.each([
  ["other:latest devstral-small:24b qwen3-coder:30b qwen3-coder:latest", "qwen3-coder:30b"],
  ["other:latest devstral-small:24b", "devstral-small:24b"],
  ["other:latest", "other:latest"],
])("proposes a local engine from Ollama's list (%s)", async (models, selected) => {
  const openCode = await executable("opencode");
  const ollama = await executable("ollama");
  const probe = vi.fn(async (bin: string) => ({
    code: 0,
    stdout:
      bin === openCode
        ? "1.2.3\n"
        : [
            "NAME ID SIZE MODIFIED",
            ...models.split(" ").map((tag) => `${tag} abc 10GB today`),
          ].join("\n"),
  }));
  await expect(
    adapter.detect({ env: { PATH: job.worktree }, platform: process.platform, run: probe }),
  ).resolves.toEqual({
    found: true,
    bin: openCode,
    version: "1.2.3",
    proposal: {
      name: "local",
      config: { ...config, model: `ollama/${selected}`, privacy: "local" },
    },
  });
  expect(probe).toHaveBeenCalledWith(ollama, ["list"], 10_000);
});

test("keeps detection usable when the Ollama probe fails", async () => {
  const openCode = await executable("opencode");
  await executable("ollama");
  const probe = vi
    .fn()
    .mockResolvedValueOnce({ code: 0, stdout: "1.2.3" })
    .mockRejectedValueOnce(new Error("timeout"));
  await expect(
    adapter.detect({ env: { PATH: job.worktree }, platform: process.platform, run: probe }),
  ).resolves.toEqual({ found: true, bin: openCode, version: "1.2.3" });
});

test("passes shell metacharacters intact through the runner in a symlinked worktree", async () => {
  const directory = join(job.worktree, "checkout");
  const worktree = join(job.worktree, "linked-checkout");
  await mkdir(directory);
  await symlink(directory, worktree, "junction");

  const prompt = "--literal; $(printf changed) | & > < `quote` $PATH\nSecond line.";
  const command = adapter.buildCommand({ ...job, worktree, prompt }, { ...config, bin });
  const result = await run(command, { timeoutMs: 5_000, logFile: join(job.runDir, "run.log") });
  expect(adapter.parseResult({ ...result, runDir: job.runDir }).ok, result.stderr).toBe(true);
  expect(await readFile(join(directory, "received-prompt.txt"), "utf8")).toBe(prompt);
});

test("delegates successfully with the fake executable and verifies the worktree change", async () => {
  const repo = createTmpRepo();
  try {
    const prompt = "Update the file.";
    const check = fileURLToPath(new URL("../fixtures/check.mjs", import.meta.url));
    await writeFile(
      join(repo.path, ".sideteam.json"),
      JSON.stringify({
        dataDir: join(repo.path, ".sideteam", "data"),
        engines: { local: { ...config, bin, privacy: "local" } },
        check: [process.execPath, check, "received-prompt.txt", prompt],
      }),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo.path, encoding: "utf8" });
    git("add", ".sideteam.json");
    git("commit", "-m", "Configure delegation");
    const client = await connectMcpClient(dirname(repo.path), {
      CLAUDE_PROJECT_DIR: repo.path,
      XDG_CONFIG_HOME: join(repo.path, "config"),
    });
    try {
      const result = await client.callTool({ name: "delegate", arguments: { prompt } });
      expect(result.isError).toBeFalsy();
      const outcome = result.structuredContent as { id: string } | undefined;
      expect(outcome).toMatchObject({
        id: expect.stringMatching(/^st-[0-9a-f]{8}$/),
        status: "success",
        engine: "local",
      });
      expect(git("show", `sideteam/${outcome?.id}:received-prompt.txt`)).toContain(prompt);
    } finally {
      await client.close();
    }
  } finally {
    repo.cleanup();
  }
});
