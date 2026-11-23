import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getAdapter } from "../../src/adapters/index.js";
import type { Job, RawOutput } from "../../src/adapters/types.js";
import { connectMcpClient } from "../helpers/mcp-client.js";
import { createTmpRepo } from "../helpers/tmp-repo.js";

const adapter = getAdapter("gemini");
const config = { adapter: "gemini" };
const bin = [
  process.execPath,
  fileURLToPath(new URL("../fixtures/engines/fake-gemini.mjs", import.meta.url)),
];
const baseArgs = [
  "-p",
  "Follow the task given on standard input.",
  "-o",
  "json",
  "--approval-mode",
  "yolo",
];

// The JSON fixtures are built from the Gemini CLI documentation.
const fixture = (kind: "success" | "error") =>
  readFile(new URL(`../fixtures/gemini/${kind}.json`, import.meta.url), "utf8");

let job: Job;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sideteam-gemini-"));
  job = {
    id: "job",
    prompt: "Update the file.",
    promptFile: join(dir, "prompt.md"),
    worktree: dir,
    runDir: dir,
  };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(job.runDir, { recursive: true, force: true });
});

function raw(stdout: string, code = 0): RawOutput {
  return { code, signal: null, timedOut: false, stdout, stderr: "", runDir: job.runDir };
}

test("builds exact arguments with and without a configured engine model", () => {
  expect(adapter.buildCommand(job, config)).toMatchObject({
    bin: "gemini",
    args: baseArgs,
    cwd: job.worktree,
  });
  const configured = { ...config, bin, model: "gemini-2.5-pro", args: ["--debug"] };
  expect(adapter.buildCommand(job, configured)).toMatchObject({
    bin: bin[0],
    args: [bin[1], ...baseArgs, "-m", "gemini-2.5-pro", "--debug"],
    cwd: job.worktree,
  });
  expect(adapter.buildCommand({ ...job, model: "gemini-2.5-flash" }, configured).args).toEqual([
    bin[1],
    ...baseArgs,
    "-m",
    "gemini-2.5-flash",
    "--debug",
  ]);
});

test("sends a long multiline prompt only on standard input", () => {
  const prompt = `--help\n${"private task ".repeat(4000)}`;
  const command = adapter.buildCommand({ ...job, prompt }, config);
  expect(command.args).toEqual(baseArgs);
  expect(command.stdin).toBe(prompt);
});

test("passes the key only when listed in env", () => {
  vi.stubEnv("GEMINI_API_KEY", "dummy");
  expect(adapter.buildCommand(job, config).env).not.toHaveProperty("GEMINI_API_KEY");
  expect(adapter.buildCommand(job, { ...config, env: ["GEMINI_API_KEY"] }).env).toHaveProperty(
    "GEMINI_API_KEY",
    "dummy",
  );
});

test("reads the final response and sums token counts across entries", async () => {
  expect(adapter.parseResult(raw(await fixture("success")))).toEqual({
    ok: true,
    message: "Updated the file.",
    tokens: { input: 25, output: 6, cached: 5 },
  });
});

test("accepts missing or partial token usage", () => {
  expect(adapter.parseResult(raw('{"response":"Done"}')).tokens).toBeNull();
  expect(
    adapter.parseResult(
      raw(
        '{"stats":{"models":{"first":{"tokens":{"prompt":"unknown","candidates":2}},"second":null}}}',
      ),
    ).tokens,
  ).toEqual({ output: 2 });
});

test.each([
  [42, "invalid input (exit 42)"],
  [53, "turn limit reached (exit 53)"],
])("translates exit %i", async (code, error) => {
  expect(adapter.parseResult(raw(await fixture("error"), code))).toMatchObject({
    ok: false,
    error,
  });
});

test("reads structured errors and includes the error tail for unexpected exits", async () => {
  const output = await fixture("error");
  expect(adapter.parseResult(raw(output))).toMatchObject({
    ok: false,
    error: "Maximum session turns reached.",
  });
  expect(adapter.parseResult(raw(output, 1)).error).toBe(
    "Engine exited with 1: Maximum session turns reached.",
  );
  expect(
    adapter.parseResult({ ...raw("", 2), stderr: `${"old\n".repeat(11)}${"x".repeat(2000)}last\n` })
      .error,
  ).toBe(`Engine exited with 2: ${"x".repeat(996)}last`);
});

test("checks the version and warns only when neither key is listed", async () => {
  await expect(adapter.check({ ...config, bin })).resolves.toEqual({
    ok: true,
    version: "1.2.3",
    message: "Neither GEMINI_API_KEY nor GOOGLE_API_KEY is listed in env",
  });
  for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
    await expect(adapter.check({ ...config, bin, env: [key] })).resolves.toEqual({
      ok: true,
      version: "1.2.3",
    });
  }
});

test("proposes Gemini only when the executable and the key name are present", async () => {
  const probe = vi.fn(async () => ({ code: 0, stdout: "1.2.3\n" }));
  const ctx = { env: { PATH: job.worktree }, platform: process.platform, run: probe };
  await expect(adapter.detect(ctx)).resolves.toEqual({ found: false });
  const executable = join(job.worktree, process.platform === "win32" ? "gemini.EXE" : "gemini");
  await writeFile(executable, "", { mode: 0o755 });
  const detected = { found: true, bin: executable, version: "1.2.3" };
  await expect(adapter.detect(ctx)).resolves.toEqual(detected);
  const env = {
    ...ctx.env,
    get GEMINI_API_KEY(): string {
      throw new Error("Detection accessed the key value");
    },
  };
  await expect(adapter.detect({ ...ctx, env })).resolves.toEqual({
    ...detected,
    proposal: { name: "gemini", config: { ...config, env: ["GEMINI_API_KEY"] } },
  });
  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe).toHaveBeenCalledWith(executable, ["--version"], 15_000);
});

test("delegates without the unlisted server key and reports exit 53 in the summary", async () => {
  const repo = createTmpRepo();
  try {
    await writeFile(
      join(repo.path, ".sideteam.json"),
      JSON.stringify({
        dataDir: join(repo.path, ".sideteam", "data"),
        engines: {
          success: { ...config, bin },
          limited: { ...config, bin, env: ["FAKE_EXIT"] },
        },
        check: [
          process.execPath,
          fileURLToPath(new URL("../fixtures/check.mjs", import.meta.url)),
          "received-prompt.txt",
          job.prompt,
        ],
      }),
    );
    const client = await connectMcpClient(dirname(repo.path), {
      CLAUDE_PROJECT_DIR: repo.path,
      XDG_CONFIG_HOME: join(repo.path, "config"),
      GEMINI_API_KEY: "dummy",
      FAKE_EXIT: "53",
    });
    try {
      const success = await client.callTool({
        name: "delegate",
        arguments: { engine: "success", prompt: job.prompt },
      });
      expect(success.isError).toBeFalsy();
      const outcome = success.structuredContent as { id: string } | undefined;
      expect(outcome).toMatchObject({
        id: expect.stringMatching(/^st-[0-9a-f]{8}$/),
        status: "success",
      });
      const committed = execFileSync(
        "git",
        ["show", `sideteam/${outcome?.id}:received-prompt.txt`],
        { cwd: repo.path, encoding: "utf8" },
      );
      expect(committed).toContain(job.prompt);

      const limited = await client.callTool({
        name: "delegate",
        arguments: { engine: "limited", prompt: job.prompt },
      });
      expect(limited.isError).toBeFalsy();
      expect(limited.structuredContent).toMatchObject({
        status: "engine_failed",
        reason: "turn limit reached (exit 53)",
      });
      expect(limited.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("turn limit reached (exit 53)"),
        }),
      );
    } finally {
      await client.close();
    }
  } finally {
    repo.cleanup();
  }
});
