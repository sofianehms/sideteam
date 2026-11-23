import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { ChangedFile, DelegationStatus } from "./summary.js";

export interface RunAttempt {
  engine: string;
  attempt: number;
  status: DelegationStatus;
  reason: string | null;
  durationMs: number;
  tokens: { input?: number; output?: number } | null;
}

export interface RunMeta {
  id: string;
  repo: string;
  base: string;
  branch: string;
  worktree: string;
  links: string[];
  engine: string;
  adapter: string;
  model: string | null;
  status: DelegationStatus | "applied" | "discarded";
  reason: string | null;
  startedAt: string;
  durationMs: number;
  tokens: { input?: number; output?: number } | null;
  attempts?: RunAttempt[];
  files: ChangedFile[];
  check: { command: NonNullable<Config["check"]>; code: number | null } | null;
}

function runDir(dataDir: string, id: string): string {
  if (!id || id === "." || id === ".." || /[\\/:]/.test(id)) {
    throw new Error(`unknown delegation ${id}`);
  }
  return join(dataDir, "runs", id);
}

const artifacts = ["prompt.md", "setup.log", "engine.log", "check.log"];

export function attemptDir(dataDir: string, id: string, attempt: number): string {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("invalid attempt number");
  return join(runDir(dataDir, id), `attempt-${attempt}`);
}

export async function createRunDir(dataDir: string, id: string, attempt?: number): Promise<string> {
  const directory = attempt === undefined ? runDir(dataDir, id) : attemptDir(dataDir, id, attempt);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of artifacts) {
    const file = await open(join(directory, name), "a", 0o600);
    await file.close();
  }
  return directory;
}

export async function publishRunArtifacts(dataDir: string, id: string, directory: string) {
  const destination = await createRunDir(dataDir, id);
  await Promise.all(
    artifacts.map((name) => copyFile(join(directory, name), join(destination, name))),
  );
}

export async function readMeta(dataDir: string, id: string): Promise<RunMeta> {
  try {
    return JSON.parse(await readFile(join(runDir(dataDir, id), "meta.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`unknown delegation ${id}`);
    }
    throw error;
  }
}

export async function writeMeta(dataDir: string, meta: RunMeta): Promise<void> {
  const directory = runDir(dataDir, meta.id);
  const temporary = join(directory, `meta-${randomUUID()}.tmp`);
  const record: RunMeta = {
    id: meta.id,
    repo: meta.repo,
    base: meta.base,
    branch: meta.branch,
    worktree: meta.worktree,
    links: [...meta.links],
    engine: meta.engine,
    adapter: meta.adapter,
    model: meta.model,
    status: meta.status,
    reason: meta.reason,
    startedAt: meta.startedAt,
    durationMs: meta.durationMs,
    tokens: meta.tokens && { input: meta.tokens.input, output: meta.tokens.output },
    attempts: meta.attempts,
    files: meta.files.map(({ path, added, deleted }) => ({ path, added, deleted })),
    check: meta.check && { command: meta.check.command, code: meta.check.code },
  };
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") await rm(temporary, { force: true });
    throw error;
  });
  try {
    await rename(temporary, join(directory, "meta.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
