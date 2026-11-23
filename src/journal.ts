import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const count = z.number().int().nonnegative();
const tokenCount = count.optional().catch(undefined);
const identity = {
  ts: z.iso.datetime(),
  id: z.string().min(1),
};

const journalEvent = z.discriminatedUnion("type", [
  z.object({
    ...identity,
    type: z.literal("delegation"),
    repo: z.string(),
    engine: z.string(),
    adapter: z.string(),
    model: z.string().nullable(),
    status: z.enum(["success", "check_failed", "engine_failed", "timeout"]),
    attempts: count,
    durationMs: count,
    files: count,
    added: count,
    deleted: count,
    tokens: z.object({ input: tokenCount, output: tokenCount, cached: tokenCount }).nullable(),
  }),
  z.object({ ...identity, type: z.literal("apply") }),
  z.object({ ...identity, type: z.literal("discard") }),
]);

export type JournalEvent = z.infer<typeof journalEvent>;

export async function appendEvent(dataDir: string, event: JournalEvent): Promise<void> {
  const record = journalEvent.parse(event);
  if (
    record.type === "delegation" &&
    Object.values(record.tokens ?? {}).every((value) => value === undefined)
  ) {
    record.tokens = null;
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "journal.jsonl");
  // An interrupted write can leave an unterminated fragment; start a fresh line so it cannot swallow this event.
  const existing = await readFile(file, "utf8").catch(() => "");
  const prefix = existing !== "" && !existing.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${prefix}${JSON.stringify(record)}\n`, { mode: 0o600 });
}

export async function readEvents(dataDir: string) {
  const events: JournalEvent[] = [];
  let malformed = 0;
  const contents = await readFile(join(dataDir, "journal.jsonl"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    try {
      events.push(journalEvent.parse(JSON.parse(line)));
    } catch {
      malformed++;
    }
  }
  return { events, malformed };
}
