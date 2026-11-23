import { randomBytes } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, stat, symlink } from "node:fs/promises";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { GitError, git } from "./git.js";

const directory = ".sideteam";
const identity = ["-c", "user.name=SideTeam", "-c", "user.email=sideteam@localhost"];

export function newId(): string {
  return `st-${randomBytes(4).toString("hex")}`;
}

async function ifMissing<T>(operation: Promise<T>): Promise<T | undefined> {
  try {
    return await operation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function ensureExcluded(repoRoot: string): Promise<void> {
  const { stdout } = await git(["rev-parse", "--git-common-dir"], { cwd: repoRoot });
  const file = resolve(repoRoot, stdout.replace(/\r?\n$/, ""), "info", "exclude");
  const contents = (await ifMissing(readFile(file, "utf8"))) ?? "";
  const entry = `${directory}/`;
  if (contents.split(/\r?\n/).includes(entry)) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${contents && !contents.endsWith("\n") ? "\n" : ""}${entry}\n`);
}

async function linkDependency(repoRoot: string, worktreePath: string, link: string) {
  const parts = link.split(/[\\/]/).filter((part) => part && part !== ".");
  if (
    !parts.length ||
    posix.isAbsolute(link) ||
    win32.isAbsolute(link) ||
    /^[a-z]:/i.test(link) ||
    parts.some((part) => part === ".." || part.toLowerCase() === ".git") ||
    parts[0] === directory
  ) {
    return;
  }
  const source = resolve(repoRoot, ...parts);
  const sourceStat = await ifMissing(stat(source));
  if (!sourceStat) return;

  const name = parts.pop() as string;
  let parent = worktreePath;
  for (const part of parts) {
    parent = join(parent, part);
    const entry = await ifMissing(lstat(parent));
    if (entry && !entry.isDirectory()) return;
    if (!entry) await mkdir(parent);
  }
  const destination = join(parent, name);
  if (await ifMissing(lstat(destination))) return;
  const type = sourceStat.isDirectory()
    ? process.platform === "win32"
      ? "junction"
      : "dir"
    : "file";
  await symlink(source, destination, type);
  return [...parts, name].join("/");
}

export async function createWorktree(
  repoRoot: string,
  id: string,
  { links }: { links: readonly string[] },
): Promise<{ id: string; path: string; branch: string; base: string; linked: string[] }> {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error(`Invalid worktree ID: ${id}`);
  const cwd = repoRoot;
  const head = await git(["rev-parse", "--verify", "HEAD"], { cwd, allowFailure: true });
  if (head.code !== 0) {
    await git(["rev-parse", "--git-dir"], { cwd });
    throw new Error("repository has no commits");
  }

  const base = head.stdout.trim();
  const branch = `sideteam/${id}`;
  let parent = resolve(repoRoot);
  for (const part of [directory, "wt"]) {
    parent = join(parent, part);
    const entry = await ifMissing(lstat(parent));
    if (entry && !entry.isDirectory()) throw new Error(`Expected a directory: ${parent}`);
    if (!entry) await mkdir(parent);
  }
  const path = join(parent, id);
  if (await ifMissing(lstat(path))) throw new Error(`Worktree path already exists: ${path}`);
  await ensureExcluded(repoRoot);
  await git(["worktree", "add", "-b", branch, "--", path, base], { cwd });

  const linked: string[] = [];
  try {
    for (const link of links) {
      const created = await linkDependency(repoRoot, path, link);
      if (created) linked.push(created);
    }
  } catch (error) {
    await removeWorktree(repoRoot, { path, branch }, "force");
    throw error;
  }
  return { id, path, branch, base, linked };
}

async function withIdentity(args: string[], cwd: string) {
  try {
    return await git(args, { cwd });
  } catch (error) {
    if (
      !(error instanceof GitError) ||
      !/Author identity unknown|Committer identity unknown/.test(error.stderr)
    ) {
      throw error;
    }
    return git([...identity, ...args], { cwd });
  }
}

export async function commitAll(
  worktreePath: string,
  message: string,
  { exclude }: { exclude: readonly string[] },
): Promise<boolean> {
  const cwd = worktreePath;
  const exclusions = exclude.map((link) => `:(exclude,literal)${link}`);
  await git(["add", "-A", "--", ".", ...exclusions], { cwd });
  if (exclusions.length > 0) {
    // A delegation may have staged a dependency link before this call.
    await git(["reset", "-q", "HEAD", "--", ...exclude.map((link) => `:(literal)${link}`)], {
      cwd,
    });
  }
  const staged = await git(["diff", "--cached", "--name-only", "-z"], { cwd });
  if (!staged.stdout) return false;
  await withIdentity(["commit", "-m", message], cwd);
  return true;
}

function paths(output: string): string[] {
  return output.split("\0").slice(0, -1);
}

export async function changes(repoRoot: string, base: string, branch: string) {
  const cwd = repoRoot;
  const range = `${base}..${branch}`;
  const [stats, diff, count] = await Promise.all([
    git(["diff", "--no-renames", "--numstat", "-z", range, "--"], { cwd }),
    git(["diff", range, "--"], { cwd }),
    git(["rev-list", "--count", range, "--"], { cwd }),
  ]);
  const files = paths(stats.stdout).map((entry) => {
    const first = entry.indexOf("\t");
    const second = entry.indexOf("\t", first + 1);
    const added = entry.slice(0, first);
    const deleted = entry.slice(first + 1, second);
    return {
      path: entry.slice(second + 1),
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted),
      binary: added === "-",
    };
  });
  return { files, diff: diff.stdout, commits: Number(count.stdout) };
}

type MergeResult =
  | { ok: true; commit: string }
  | {
      ok: false;
      reason: "detached-head" | "merge-in-progress" | "dirty-overlap" | "conflict";
      files: string[];
    };

export async function mergeIntoCurrent(
  repoRoot: string,
  { base, branch, message }: { base: string; branch: string; message: string },
): Promise<MergeResult> {
  const cwd = repoRoot;
  const head = await git(["symbolic-ref", "-q", "HEAD"], { cwd, allowFailure: true });
  if (head.code === 1) return { ok: false, reason: "detached-head", files: [] };
  if (head.code !== 0) throw new GitError(["symbolic-ref", "-q", "HEAD"], head.code, head.stderr);

  const { stdout } = await git(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd });
  const mergeHead = resolve(cwd, stdout.replace(/\r?\n$/, ""));
  if (await ifMissing(lstat(mergeHead))) {
    return { ok: false, reason: "merge-in-progress", files: [] };
  }

  const status = await git(
    ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all"],
    { cwd },
  );
  const modified = await git(
    ["diff", "--name-only", "--no-renames", "-z", `${base}..${branch}`, "--"],
    { cwd },
  );
  const changed = paths(modified.stdout);
  const dirty = paths(status.stdout).filter((entry) => !entry.slice(3).startsWith(`${directory}/`));
  const overlap = dirty
    .map((entry) => entry.slice(3))
    .filter((path) =>
      changed.some(
        (file) => file === path || file.startsWith(`${path}/`) || path.startsWith(`${file}/`),
      ),
    );
  if (overlap.length > 0) return { ok: false, reason: "dirty-overlap", files: overlap };

  // Git requires a clean index. Save the staged tree and leave the working files in place.
  const staged = dirty
    .filter((entry) => entry[0] !== " " && entry[0] !== "?")
    .map((entry) => `:(literal)${entry.slice(3)}`);
  const stagedTree =
    staged.length > 0 ? (await git(["write-tree"], { cwd })).stdout.trim() : undefined;
  if (stagedTree) await git(["reset", "-q", "HEAD", "--", ...staged], { cwd });

  try {
    await withIdentity(
      [
        "-c",
        "rerere.enabled=false",
        "merge",
        "--no-autostash",
        "--no-overwrite-ignore",
        "--no-ff",
        "-m",
        message,
        "--",
        branch,
      ],
      cwd,
    );
  } catch (error) {
    if (!(await ifMissing(lstat(mergeHead)))) throw error;
    const conflicts = await git(["diff", "--name-only", "--diff-filter=U", "-z", "--"], { cwd });
    const files = paths(conflicts.stdout);
    await git(["merge", "--abort"], { cwd });
    if (files.length === 0) throw error;
    return { ok: false, reason: "conflict", files };
  } finally {
    if (stagedTree) await git(["reset", "-q", stagedTree, "--", ...staged], { cwd });
  }
  const commit = await git(["rev-parse", "HEAD"], { cwd });
  return { ok: true, commit: commit.stdout.trim() };
}

export async function removeWorktree(
  repoRoot: string,
  { path, branch }: { path: string; branch: string },
  mode: "merged" | "force",
): Promise<void> {
  const cwd = repoRoot;
  await git(["worktree", "remove", "--force", "--", path], { cwd });
  await git(["branch", mode === "merged" ? "-d" : "-D", "--", branch], { cwd });
  await git(["worktree", "prune"], { cwd });
}
