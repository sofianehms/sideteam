import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

test("initializes over stdio from outside the project and lists the delegation tools", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "sideteam-client-"));
  try {
    const client = await connectMcpClient(cwd);
    try {
      expect(client.getServerVersion()?.name).toBe("sideteam");
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual([
        "delegate",
        "apply",
        "discard",
        "engines",
        "stats",
      ]);
    } finally {
      await client.close();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("creates a repository on main with an initial README commit", () => {
  const { path, cleanup } = createTmpRepo();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" });
  try {
    expect(git("branch", "--show-current").trim()).toBe("main");
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(git("ls-tree", "--name-only", "HEAD").trim()).toBe("README.md");
  } finally {
    cleanup();
  }
});
