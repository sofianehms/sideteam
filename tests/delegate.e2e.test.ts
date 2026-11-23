import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

const fixture = (path: string) => fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url));
const bin = [process.execPath, fixture("engines/fake-codex.mjs")];
const engine = { adapter: "codex", bin, env: ["FAKE_MODE"] };
const check = [process.execPath, fixture("check.mjs"), "received-prompt.txt", "Make a change"];
const prompt = "Make a change";
const secret = "fixture-value-must-stay-private";
let repo: ReturnType<typeof createTmpRepo>;

beforeEach(() => {
  repo = createTmpRepo();
});

afterEach(() => {
  repo.cleanup();
});

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo.path, encoding: "utf8" });

async function delegate(
  config: Record<string, unknown> = {},
  args: Record<string, unknown> = {},
  mode = "edit",
) {
  const dataDir = join(repo.path, ".sideteam", "data");
  await writeFile(
    join(repo.path, ".sideteam.json"),
    JSON.stringify({ dataDir, engines: { a: engine }, check, ...config }),
  );
  git("add", ".");
  git("commit", "-m", "Configure delegation");
  const head = git("rev-parse", "HEAD");

  const client = await connectMcpClient(dirname(repo.path), {
    CLAUDE_PROJECT_DIR: repo.path,
    XDG_CONFIG_HOME: join(repo.path, "config"),
    FAKE_MODE: mode,
    SIDETEAM_TEST_SECRET: secret,
  });
  try {
    const result = await client.callTool({ name: "delegate", arguments: { prompt, ...args } });
    expect(git("rev-parse", "HEAD")).toBe(head);
    return result;
  } finally {
    await client.close();
  }
}

function outcome(result: Awaited<ReturnType<typeof delegate>>, status: string, reason?: string) {
  expect(result.isError).toBeFalsy();
  const structured = result.structuredContent as { id: string } | undefined;
  expect(structured).toBeDefined();
  const id = String(structured?.id);
  const nextStep = `${status === "success" ? "apply" : "discard"} ${id}`;
  expect(id).toMatch(/^st-[0-9a-f]{8}$/);
  expect(structured).toMatchObject({ status, nextStep, ...(reason ? { reason } : {}) });
  expect(result.content).toEqual([
    { type: "text", text: expect.stringContaining(`SideTeam ${id}: ${status.toUpperCase()}`) },
  ]);
  expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(nextStep) }]);
  return id;
}

function runFile(id: string, file: string) {
  return readFile(join(repo.path, ".sideteam", "data", "runs", id, file), "utf8");
}

test("commits verified changes separately and stores run artifacts under dataDir", async () => {
  const result = await delegate({}, { files: ["README.md"] });
  const id = outcome(result, "success");
  expect(git("status", "--porcelain")).toBe("");
  expect(git("branch", "--show-current").trim()).toBe("main");
  expect(await readFile(join(repo.path, "README.md"), "utf8")).toBe("# Test repository\n");
  await expect(stat(join(repo.path, "received-prompt.txt"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(git("show", `sideteam/${id}:received-prompt.txt`)).toContain(prompt);

  const [meta, log, framed] = await Promise.all(
    ["meta.json", "engine.log", "prompt.md"].map((file) => runFile(id, file)),
  );
  for (const contents of [meta, log, framed]) expect(contents).not.toContain(secret);
  expect(JSON.parse(meta)).toMatchObject({
    id,
    status: "success",
    check: { command: check, code: 0 },
    files: [{ path: "received-prompt.txt" }],
  });
  expect(log).toContain("turn.completed");
  expect(framed).toContain("- README.md");
  expect(framed).toContain(prompt);
});

test("reports a failing check despite engine completion", async () => {
  const id = outcome(await delegate({ check: [...check.slice(0, -1), "absent"] }), "check_failed");
  expect(git("show", `sideteam/${id}:received-prompt.txt`)).toContain(prompt);
});

test("uses the requested engine and check instead of the configured defaults", async () => {
  await writeFile(join(repo.path, "check.mjs"), "process.exitCode = 0;");
  const result = await delegate(
    {
      default: "a",
      engines: { a: { adapter: "missing" }, b: engine },
      check: [...check.slice(0, -1), "absent"],
    },
    { engine: "b", check: `"${process.execPath}" check.mjs` },
  );
  outcome(result, "success");
  expect(result.structuredContent).toMatchObject({ engine: "b" });
});

test("reports engine failure", async () => {
  outcome(await delegate({}, {}, "fail"), "engine_failed");
});

const generic = {
  adapter: "generic",
  command: [process.execPath, fixture("engines/fake-engine.mjs")],
  env: ["FAKE_MODE"],
};

test("reports an unavailable executable", async () => {
  outcome(
    await delegate({ engines: { a: { ...engine, bin: [join(repo.path, "missing")] } } }),
    "engine_failed",
    `not found: ${join(repo.path, "missing")}`,
  );
});

test("rejects a successful engine run with no changes", async () => {
  outcome(
    await delegate({ engines: { a: generic } }, {}, "noop"),
    "engine_failed",
    "no changes produced",
  );
});

test("uses the call timeout instead of the engine's 30 minutes", async () => {
  const started = performance.now();
  const result = await delegate(
    { engines: { a: { ...generic, timeoutMinutes: 30 } } },
    { timeoutMinutes: 0.005 },
    "hang",
  );
  outcome(result, "timeout", "engine timed out");
  expect(result.structuredContent).toMatchObject({ durationMs: expect.any(Number) });
  expect(performance.now() - started).toBeLessThan(5000);
});

const refusals = [
  [{ check: undefined }, {}, "no check configured: pass check or set it in .sideteam.json"],
  [{ engines: {} }, {}, "no engine configured: run /sideteam:setup or add one to .sideteam.json"],
  [
    { engines: { a: engine, b: engine } },
    {},
    "several engines are configured and none is the default: pass engine (one of: a, b) or set default",
  ],
  [{}, { engine: "missing" }, 'unknown engine "missing": configured engines: a'],
  [
    { engines: { a: { adapter: "missing" } } },
    {},
    'Unknown adapter "missing". Known adapters: codex, generic',
  ],
  [{}, { files: ["../outside"] }, "context file is outside the repository: ../outside"],
] as const;

test.each(
  refusals,
)("refuses invalid delegation %# before creating a worktree", async (config, args, message) => {
  const result = await delegate(config, args);
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: expect.stringContaining(message) }]);
  await expect(readdir(join(repo.path, ".sideteam", "wt"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test("rejects a context symlink whose target is outside the repository", async () => {
  await symlink("..", join(repo.path, "outside"));
  const result = await delegate({}, { files: ["outside"] });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    {
      type: "text",
      text: expect.stringContaining("context file is outside the repository: outside"),
    },
  ]);
  await expect(stat(join(repo.path, ".sideteam", "wt"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("checks a project using its linked ignored dependencies", async () => {
  const dependency = join(repo.path, "node_modules", "dep");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(repo.path, ".gitignore"), "node_modules/\n");
  await writeFile(join(dependency, "index.js"), 'module.exports = "ready";');
  await writeFile(
    join(repo.path, "check.mjs"),
    `import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import dep from "dep";

// A bare import can also resolve through the parent repository's node_modules.
assert.ok(lstatSync(new URL("./node_modules", import.meta.url)).isSymbolicLink());
assert.equal(dep, "ready");
`,
  );
  const id = outcome(await delegate({ check: [process.execPath, "check.mjs"] }), "success");
  expect(git("diff", "--name-only", `HEAD..sideteam/${id}`).trim()).toBe("received-prompt.txt");
  expect(git("status", "--porcelain")).toBe("");
  expect(await readFile(join(dependency, "index.js"), "utf8")).toBe('module.exports = "ready";');
});

test.each([false, true])("runs preparation before the engine (failure: %s)", async (fails) => {
  await writeFile(
    join(repo.path, "setup.mjs"),
    `import { writeFileSync } from "node:fs"; writeFileSync("prepared.txt", "ready"); process.exitCode = ${fails ? 7 : 0};`,
  );
  const result = await delegate(
    {
      worktree: { setup: `"${process.execPath}" setup.mjs` },
      check: [process.execPath, fixture("check.mjs"), "prepared.txt", "ready"],
    },
    {},
  );
  const id = fails
    ? outcome(result, "engine_failed", "worktree setup failed (exit 7)")
    : outcome(result, "success");
  expect(git("show", `sideteam/${id}:prepared.txt`)).toBe("ready");
  if (fails) {
    expect(await runFile(id, "engine.log")).toBe("");
    expect(git("diff", "--name-only", `HEAD..sideteam/${id}`).trim()).toBe("prepared.txt");
  }
  expect(git("status", "--porcelain")).toBe("");
});
