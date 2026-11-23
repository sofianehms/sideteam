import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { git } from "./git.js";
import { appendEvent, readEvents } from "./journal.js";
import { dataDir } from "./paths.js";
import { promptInstruction } from "./prompt.js";
import { type RunMeta, readMeta, writeMeta } from "./runs.js";
import { mergeIntoCurrent, removeWorktree } from "./worktree.js";

type Outcome = "apply" | "discard";

// Records the outcome event unless the journal already has it. Returns false when the journal is unavailable.
async function recordOutcome(directory: string, type: Outcome, id: string) {
  try {
    const { events } = await readEvents(directory);
    if (!events.some((event) => event.type === type && event.id === id)) {
      await appendEvent(directory, { type, ts: new Date().toISOString(), id });
    }
    return true;
  } catch {
    return false;
  }
}

const JOURNAL_WARNING =
  " (journal unavailable: the event will be recorded on the next apply or discard retry)";

const activeRepos = new Set<string>();

async function finalizeRun(
  id: string,
  env: NodeJS.ProcessEnv,
  operation: (run: { directory: string; meta: RunMeta }) => Promise<string>,
) {
  const root = await git(["rev-parse", "--show-toplevel"], {
    cwd: env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    allowFailure: true,
  });
  if (root.code !== 0) throw new Error("not inside a git repository");
  const repo = await realpath(root.stdout.replace(/\r?\n$/, ""));
  if (activeRepos.has(repo))
    throw new Error("A delegation is already being finalized in this repository");
  activeRepos.add(repo);
  try {
    const { config } = loadConfig({ repoRoot: repo, env });
    const directory = dataDir(config, { env });
    const meta = await readMeta(directory, id);
    if (meta.repo !== repo) throw new Error(`unknown delegation ${id}`);
    return await operation({ directory, meta });
  } finally {
    activeRepos.delete(repo);
  }
}

export function applyDelegation(id: string, env = process.env) {
  return finalizeRun(id, env, async ({ directory, meta }) => {
    if (meta.status === "applied" || meta.status === "discarded") {
      await recordOutcome(directory, meta.status === "applied" ? "apply" : "discard", id);
      throw new Error(`Delegation ${id} is already ${meta.status}`);
    }

    const prompt = await readFile(join(directory, "runs", id, "prompt.md"), "utf8");
    const instruction = promptInstruction(prompt);
    const title = Array.from(instruction.split(/\r?\n/, 1)[0]).slice(0, 60).join("");
    const result = await mergeIntoCurrent(meta.repo, {
      base: meta.base,
      branch: meta.branch,
      message: `Merge sideteam/${id}: ${title}`,
    });
    if (!result.ok) {
      throw new Error([`Cannot apply ${id}: ${result.reason}`, ...result.files].join("\n"));
    }

    await removeWorktree(meta.repo, { path: meta.worktree, branch: meta.branch }, "merged");
    await writeMeta(directory, { ...meta, status: "applied" });
    const recorded = await recordOutcome(directory, "apply", id);
    return `Applied ${id}: merge commit ${result.commit}, ${meta.files.length} files${recorded ? "" : JOURNAL_WARNING}`;
  });
}

export function discardDelegation(id: string, env = process.env) {
  return finalizeRun(id, env, async ({ directory, meta }) => {
    if (meta.status === "applied") {
      await recordOutcome(directory, "apply", id);
      throw new Error(`Delegation ${id} is already applied`);
    }
    if (meta.status !== "discarded") {
      await removeWorktree(meta.repo, { path: meta.worktree, branch: meta.branch }, "force");
      await writeMeta(directory, { ...meta, status: "discarded" });
    }
    const recorded = await recordOutcome(directory, "discard", id);
    return `Discarded ${id}${recorded ? "" : JOURNAL_WARNING}`;
  });
}
