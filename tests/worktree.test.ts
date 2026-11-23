import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveLinks } from "../src/config.js";
import { GitError, git } from "../src/git.js";
import {
  changes,
  commitAll,
  createWorktree,
  ensureExcluded,
  mergeIntoCurrent,
  newId,
  removeWorktree,
} from "../src/worktree.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

describe("worktrees", () => {
  let repo: ReturnType<typeof createTmpRepo>;

  beforeEach(() => {
    repo = createTmpRepo();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    repo.cleanup();
  });

  async function main(...args: string[]) {
    return (await git(args, { cwd: repo.path })).stdout;
  }

  async function delegate(file = "README.md", content = "# Delegated\n") {
    const worktree = await createWorktree(repo.path, newId(), { links: [] });
    writeFileSync(join(worktree.path, file), content);
    await commitAll(worktree.path, "Delegate change", { exclude: worktree.linked });
    return worktree;
  }

  function apply(worktree: { base: string; branch: string }) {
    return mergeIntoCurrent(repo.path, { ...worktree, message: "Apply delegation" });
  }

  async function snapshot(...files: string[]) {
    return {
      status: await main("status", "--porcelain"),
      head: await main("rev-parse", "HEAD"),
      contents: files.map((file) => readFileSync(join(repo.path, file))),
      staged: await main("diff", "--cached", "--binary"),
    };
  }

  async function expectBranch(branch: string) {
    expect(await main("branch", "--list", branch)).toContain(branch);
  }

  it("creates a registered worktree from HEAD and excludes its directory once", async () => {
    const id = newId();
    expect(id).toMatch(/^st-[a-f0-9]{8}$/);
    const base = (await main("rev-parse", "HEAD")).trim();
    const worktree = await createWorktree(repo.path, id, { links: [] });
    expect(worktree).toEqual({
      id,
      path: join(repo.path, ".sideteam", "wt", id),
      branch: `sideteam/${id}`,
      base,
      linked: [],
    });
    expect(existsSync(join(worktree.path, "README.md"))).toBe(true);
    await expectBranch(worktree.branch);
    expect(await main("worktree", "list", "--porcelain")).toContain(worktree.branch);
    await ensureExcluded(worktree.path);
    const exclude = await readFile(join(repo.path, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === ".sideteam/")).toHaveLength(1);
    expect(await main("status", "--porcelain")).toBe("");
  });

  it("recreates a worktree at its original base after HEAD advances", async () => {
    const first = await delegate();
    await removeWorktree(repo.path, first, "force");
    writeFileSync(join(repo.path, "README.md"), "# New HEAD\n");
    await main("commit", "-am", "Advance HEAD");

    const recreated = await createWorktree(repo.path, first.id, { links: [], base: first.base });
    expect(recreated).toEqual(first);
    expect((await main("rev-parse", recreated.branch)).trim()).toBe(first.base);
    expect(readFileSync(join(recreated.path, "README.md"), "utf8")).toBe("# Test repository\n");
    expect(readFileSync(join(repo.path, "README.md"), "utf8")).toBe("# New HEAD\n");
  });

  it("commits changed files, reports text and binary stats, and skips empty commits", async () => {
    const worktree = await createWorktree(repo.path, newId(), { links: [] });
    expect(await commitAll(worktree.path, "Empty", { exclude: [] })).toBe(false);
    writeFileSync(join(worktree.path, "README.md"), "# Delegated\nSecond line\n");
    writeFileSync(join(worktree.path, "binary file"), Buffer.from([0, 1, 2]));
    expect(await commitAll(worktree.path, "Delegate change", { exclude: [] })).toBe(true);
    expect(await commitAll(worktree.path, "Empty", { exclude: [] })).toBe(false);
    const result = await changes(repo.path, worktree.base, worktree.branch);
    expect(result.files).toEqual([
      { path: "README.md", added: 2, deleted: 1, binary: false },
      { path: "binary file", added: 0, deleted: 0, binary: true },
    ]);
    expect(result.diff).toContain("+# Delegated");
    expect(result.commits).toBe(1);
    expect(readFileSync(join(repo.path, "README.md"), "utf8")).toBe("# Test repository\n");
  });

  it("commits with a fallback identity when Git has none", async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(repo.path, "missing-config"));
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    await main("config", "--unset", "user.name");
    await main("config", "--unset", "user.email");
    await main("config", "user.useConfigOnly", "true");
    const worktree = await delegate();
    expect(await main("log", "-1", "--format=%an <%ae>", worktree.branch)).toBe(
      "SideTeam <sideteam@localhost>\n",
    );
  });

  it("keeps delegation history in a two-parent merge and removes the merged worktree", async () => {
    const worktree = await delegate();
    const delegated = (await main("rev-parse", worktree.branch)).trim();
    expect(await apply(worktree)).toEqual({
      ok: true,
      commit: (await main("rev-parse", "HEAD")).trim(),
    });
    expect(await main("log", "-1", "--merges", "--format=%P")).toBe(
      `${worktree.base} ${delegated}\n`,
    );
    expect(await main("log", "--format=%H")).toContain(delegated);
    expect(readFileSync(join(repo.path, "README.md"), "utf8")).toBe("# Delegated\n");
    await removeWorktree(repo.path, worktree, "merged");
    expect(existsSync(worktree.path)).toBe(false);
    expect(await main("branch", "--list", worktree.branch)).toBe("");
    expect(await main("worktree", "list", "--porcelain")).not.toContain(worktree.branch);
  });

  it("refuses a dirty overlap without changing files, status, or the delegation branch", async () => {
    const worktree = await delegate();
    writeFileSync(join(repo.path, "README.md"), "Local edit\n");
    await main("add", "README.md");
    writeFileSync(join(repo.path, "README.md"), "Further local edit\n");
    const before = await snapshot("README.md");
    expect(await apply(worktree)).toEqual({
      ok: false,
      reason: "dirty-overlap",
      files: ["README.md"],
    });
    expect(await snapshot("README.md")).toEqual(before);
    await expectBranch(worktree.branch);
  });

  async function editUnrelatedFiles() {
    writeFileSync(join(repo.path, "local.txt"), "Staged content\n");
    await main("add", "local.txt");
    writeFileSync(join(repo.path, "local.txt"), "Unstaged content\n");
    writeFileSync(join(repo.path, "untracked.txt"), "Untracked content\n");
  }

  it("preserves unrelated staged, unstaged and untracked changes during a merge", async () => {
    const worktree = await delegate();
    await editUnrelatedFiles();
    const before = await snapshot("local.txt", "untracked.txt");
    const result = await apply(worktree);
    expect(result.ok).toBe(true);
    expect(await snapshot("local.txt", "untracked.txt")).toEqual({
      ...before,
      head: await main("rev-parse", "HEAD"),
    });
    expect(readFileSync(join(repo.path, "README.md"), "utf8")).toBe("# Delegated\n");
  });

  async function conflictingBranches() {
    const worktree = await delegate();
    writeFileSync(join(repo.path, "README.md"), "Different committed content\n");
    await main("commit", "-am", "Change the same line");
    return worktree;
  }

  it("aborts a real conflict and restores the original files and status", async () => {
    const worktree = await conflictingBranches();
    await editUnrelatedFiles();
    const before = await snapshot("README.md", "local.txt", "untracked.txt");
    expect(await apply(worktree)).toEqual({ ok: false, reason: "conflict", files: ["README.md"] });
    expect(await snapshot("README.md", "local.txt", "untracked.txt")).toEqual(before);
    expect(existsSync(join(repo.path, ".git", "MERGE_HEAD"))).toBe(false);
    await expectBranch(worktree.branch);
  });

  it("preserves an existing merge", async () => {
    const worktree = await conflictingBranches();
    await expect(main("merge", "--no-ff", worktree.branch)).rejects.toBeInstanceOf(GitError);
    const before = await snapshot("README.md");
    expect(await apply(worktree)).toEqual({ ok: false, reason: "merge-in-progress", files: [] });
    expect(await snapshot("README.md")).toEqual(before);
    expect(existsSync(join(repo.path, ".git", "MERGE_HEAD"))).toBe(true);
    await expectBranch(worktree.branch);
  });

  it("refuses a detached HEAD without changing files or status", async () => {
    const worktree = await delegate();
    await main("checkout", "--detach");
    const before = await snapshot("README.md");
    expect(await apply(worktree)).toEqual({ ok: false, reason: "detached-head", files: [] });
    expect(await snapshot("README.md")).toEqual(before);
    await expectBranch(worktree.branch);
  });

  it("force-removes an unmerged worktree and branch", async () => {
    const worktree = await delegate();
    writeFileSync(join(worktree.path, "README.md"), "Uncommitted\n");
    await removeWorktree(repo.path, worktree, "force");
    expect(existsSync(worktree.path)).toBe(false);
    expect(await main("branch", "--list", worktree.branch)).toBe("");
    expect(await main("worktree", "list", "--porcelain")).not.toContain(worktree.branch);
  });

  it("rejects a repository without commits", async () => {
    const empty = join(repo.path, "empty");
    await mkdir(empty);
    await git(["init"], { cwd: empty });
    await expect(createWorktree(empty, newId(), { links: [] })).rejects.toThrow(
      "repository has no commits",
    );
    expect(existsSync(join(empty, ".sideteam"))).toBe(false);
  });

  it("creates info/exclude when it is missing", async () => {
    await rm(join(repo.path, ".git", "info"), { recursive: true });
    await ensureExcluded(repo.path);
    expect(await readFile(join(repo.path, ".git", "info", "exclude"), "utf8")).toBe(".sideteam/\n");
  });

  it("runs checks with default dependency links and never stages, commits, or removes their targets", async () => {
    const dependency = join(repo.path, "node_modules", "dep", "index.js");
    await mkdir(join(repo.path, "node_modules", "dep"), { recursive: true });
    writeFileSync(dependency, "module.exports = 42;\n");
    writeFileSync(join(repo.path, ".gitignore"), "node_modules/\n");
    writeFileSync(
      join(repo.path, "check.mjs"),
      'import dep from "./node_modules/dep/index.js";\nif (dep !== 42) process.exit(1);\n',
    );
    await main("add", ".gitignore", "check.mjs");
    await main("commit", "-m", "Add dependency check");

    const linked = await createWorktree(repo.path, newId(), {
      links: effectiveLinks({ worktree: {} }),
    });
    const unlinked = await createWorktree(repo.path, newId(), { links: [] });
    expect(linked.linked).toEqual(["node_modules"]);
    expect(existsSync(join(linked.path, ".venv"))).toBe(false);
    const check = (cwd: string) =>
      execFileSync(process.execPath, ["check.mjs"], { cwd, stdio: "pipe" });
    expect(() => check(linked.path)).not.toThrow();
    expect(() => check(unlinked.path)).toThrow();

    await git(["add", "-f", "node_modules"], { cwd: linked.path });
    expect(await commitAll(linked.path, "Only a link", { exclude: linked.linked })).toBe(false);
    writeFileSync(join(linked.path, "README.md"), "Delegated work\n");
    expect(
      await commitAll(linked.path, "Delegate with dependencies", { exclude: linked.linked }),
    ).toBe(true);
    expect(await main("show", "--stat", linked.branch)).toContain("README.md");
    expect(await main("show", "--stat", linked.branch)).not.toContain("node_modules");
    expect(await main("log", "--format=%H", linked.branch, "--", "node_modules")).toBe("");
    await removeWorktree(repo.path, linked, "force");
    expect(readFileSync(dependency, "utf8")).toBe("module.exports = 42;\n");
  });
});
