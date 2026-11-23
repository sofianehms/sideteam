import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readMeta } from "../src/runs.js";
import { createServer } from "../src/server.js";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

const fixture = fileURLToPath(new URL("./fixtures/engines/fake-engine.mjs", import.meta.url));
const title = "Replace the repository README with the proposed project description and details";
const changed = "Delegated README\n";
let repo: ReturnType<typeof createTmpRepo>;
let client: Awaited<ReturnType<typeof connectMcpClient>> | undefined;
let dataDir: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo.path, encoding: "utf8" });

beforeEach(async () => {
  repo = createTmpRepo();
  dataDir = join(repo.path, ".sideteam", "data");
  await writeFile(
    join(repo.path, ".sideteam.json"),
    JSON.stringify({
      dataDir,
      engines: {
        fixture: {
          adapter: "generic",
          command: [process.execPath, fixture],
          env: ["FAKE_MODE", "FAKE_FILE", "FAKE_CONTENT"],
        },
      },
      check: [
        process.execPath,
        "-e",
        "if (!require('node:fs').existsSync('README.md')) process.exit(1)",
      ],
    }),
  );
  git("add", ".sideteam.json");
  git("commit", "-m", "Configure delegation");
  client = await connectMcpClient(dirname(repo.path), {
    CLAUDE_PROJECT_DIR: repo.path,
    XDG_CONFIG_HOME: join(repo.path, "config"),
    FAKE_MODE: "edit",
    FAKE_FILE: "README.md",
    FAKE_CONTENT: changed,
  });
});

afterEach(async () => {
  try {
    await client?.close();
  } finally {
    client = undefined;
    repo.cleanup();
  }
});

async function delegate() {
  const result = await client?.callTool({
    name: "delegate",
    arguments: { prompt: `${title}\nAdditional instruction` },
  });
  expect(result?.isError).toBeFalsy();
  expect(result?.structuredContent).toMatchObject({ status: "success" });
  const { id } = result?.structuredContent as { id: string };
  return readMeta(dataDir, id);
}

function call(name: "apply" | "discard", id: string) {
  return client?.callTool({ name, arguments: { id } });
}

async function expectRemoved(meta: Awaited<ReturnType<typeof delegate>>, status: string) {
  await expect(lstat(meta.worktree)).rejects.toMatchObject({ code: "ENOENT" });
  expect(git("branch", "--list", meta.branch)).toBe("");
  expect(git("worktree", "list", "--porcelain")).not.toContain(meta.branch);
  expect(await readMeta(dataDir, meta.id)).toMatchObject({ status });
}

test("applies a delegation with a merge commit and refuses further changes", async () => {
  const meta = await delegate();
  const head = git("rev-parse", "HEAD").trim();
  const branch = git("rev-parse", meta.branch).trim();
  const result = await call("apply", meta.id);
  const commit = git("rev-parse", "HEAD").trim();
  expect(result?.isError).toBeFalsy();
  expect(result?.content).toEqual([
    { type: "text", text: `Applied ${meta.id}: merge commit ${commit}, 1 files` },
  ]);
  expect(git("show", "-s", "--format=%P", "HEAD").trim()).toBe(`${head} ${branch}`);
  expect(git("show", "-s", "--format=%s", "HEAD").trim()).toBe(
    `Merge sideteam/${meta.id}: ${title.slice(0, 60)}`,
  );
  expect(await readFile(join(repo.path, "README.md"), "utf8")).toBe(changed);
  await expectRemoved(meta, "applied");
  for (const name of ["apply", "discard"] as const) {
    expect(await call(name, meta.id)).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("already applied") }],
    });
    expect(git("rev-parse", "HEAD").trim()).toBe(commit);
  }
});

test("refuses dirty overlap and applies after the change is committed on another branch", async () => {
  const meta = await delegate();
  const readme = join(repo.path, "README.md");
  const local = "Uncommitted README\n";
  const head = git("rev-parse", "HEAD");
  await writeFile(readme, local);
  const status = git("status", "--porcelain");
  expect(await call("apply", meta.id)).toMatchObject({
    isError: true,
    content: [{ type: "text", text: `Cannot apply ${meta.id}: dirty-overlap\nREADME.md` }],
  });
  expect(await readFile(readme, "utf8")).toBe(local);
  expect(git("status", "--porcelain")).toBe(status);
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("branch", "--list", meta.branch)).toContain(meta.branch);
  expect((await lstat(meta.worktree)).isDirectory()).toBe(true);
  expect(await readMeta(dataDir, meta.id)).toEqual(meta);

  git("switch", "-c", "local-edits");
  git("add", "README.md");
  git("commit", "-m", "Save local README");
  git("switch", "main");
  expect((await call("apply", meta.id))?.isError).toBeFalsy();
  expect(git("show", "local-edits:README.md")).toBe(local);
  expect(await readFile(readme, "utf8")).toBe(changed);
  await expectRemoved(meta, "applied");
});

test("aborts a real conflict and keeps the branch and worktree", async () => {
  const meta = await delegate();
  const readme = join(repo.path, "README.md");
  const local = "Committed README\n";
  await writeFile(readme, local);
  git("add", "README.md");
  git("commit", "-m", "Replace README independently");
  await writeFile(join(repo.path, "staged.txt"), "Staged content\n");
  git("add", "staged.txt");
  await writeFile(join(repo.path, "staged.txt"), "Working copy\n");
  const head = git("rev-parse", "HEAD");
  const branch = git("rev-parse", meta.branch);
  const status = git("status", "--porcelain");

  expect(await call("apply", meta.id)).toMatchObject({
    isError: true,
    content: [{ type: "text", text: `Cannot apply ${meta.id}: conflict\nREADME.md` }],
  });
  expect(git("status", "--porcelain")).toBe(status);
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("rev-parse", meta.branch)).toBe(branch);
  expect(git("show", ":staged.txt")).toBe("Staged content\n");
  expect(await readFile(join(repo.path, "staged.txt"), "utf8")).toBe("Working copy\n");
  expect(await readFile(readme, "utf8")).toBe(local);
  expect(await readFile(join(meta.worktree, "README.md"), "utf8")).toBe(changed);
  expect(await readMeta(dataDir, meta.id)).toEqual(meta);
});

test("discards a delegation without deleting the target of its dependency link", async () => {
  await mkdir(join(repo.path, "node_modules"));
  const dependency = join(repo.path, "node_modules", "dependency.txt");
  await writeFile(dependency, "Keep this dependency\n");
  const meta = await delegate();
  const head = git("rev-parse", "HEAD");

  expect((await lstat(join(meta.worktree, "node_modules"))).isSymbolicLink()).toBe(true);
  expect((await call("discard", meta.id))?.isError).toBeFalsy();
  await expectRemoved(meta, "discarded");
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(await readFile(dependency, "utf8")).toBe("Keep this dependency\n");
  expect((await call("discard", meta.id))?.isError).toBeFalsy();
  expect(await call("apply", meta.id)).toMatchObject({
    isError: true,
    content: [{ type: "text", text: expect.stringContaining("already discarded") }],
  });
});

test.each(["apply", "discard"] as const)("%s refuses an unknown delegation", async (name) => {
  const head = git("rev-parse", "HEAD");
  expect(await call(name, "st-00000000")).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "unknown delegation st-00000000" }],
  });
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("status", "--porcelain")).toBe("");
});

// Subprocess executions are outside the Vitest coverage collector.
test("finalizes runs through the server in process", async () => {
  const applied = await delegate();
  const discarded = await delegate();
  vi.stubGlobal("__SIDETEAM_VERSION__", "0.0.0");
  vi.stubEnv("CLAUDE_PROJECT_DIR", repo.path);
  vi.stubEnv("XDG_CONFIG_HOME", join(repo.path, "config"));
  const server = createServer();
  const localClient = new Client({ name: "sideteam-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await localClient.connect(clientTransport);
    for (const [name, meta] of [
      ["apply", applied],
      ["discard", discarded],
    ] as const) {
      const result = await localClient.callTool({ name, arguments: { id: meta.id } });
      expect(result.isError).toBeFalsy();
      await expectRemoved(meta, name === "apply" ? "applied" : "discarded");
    }
  } finally {
    await localClient.close();
    await server.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
