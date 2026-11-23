import { createReadStream } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";

const transcriptTokenCount = z.number().int().nonnegative().optional().catch(undefined);
const transcriptUsageSchema = z.object({
  input_tokens: transcriptTokenCount,
  output_tokens: transcriptTokenCount,
  cache_creation_input_tokens: transcriptTokenCount,
  cache_read_input_tokens: transcriptTokenCount,
});
const transcriptBlockSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    tool_use_id: z.string().optional(),
    content: z.unknown(),
  })
  .refine(({ type, id, name, tool_use_id, content }) => {
    if (type === "tool_use") return !!id && !!name;
    if (type === "tool_result") return !!tool_use_id && content !== undefined;
    return true;
  });
const transcriptEntrySchema = z.object({
  type: z.string(),
  cwd: z.string().optional(),
  message: z.unknown(),
});
const assistantMessageSchema = z.object({
  id: z.string().optional(),
  content: z.array(transcriptBlockSchema),
  usage: transcriptUsageSchema.optional().catch(undefined),
});
const userMessageSchema = z.object({
  content: z.union([z.string(), z.array(transcriptBlockSchema)]),
});
const metadataTypes = new Set([
  "summary",
  "system",
  "progress",
  "file-history-snapshot",
  "queue-operation",
  "custom-title",
  "tag",
  "attachment",
  "pr-link",
]);
const toolName = /(?:^|__)(?:sideteam|plugin_[^_]+_sideteam)__(delegate|apply|discard)$/;
type Tool = "delegate" | "apply" | "discard";
type Result = { id: string; tool: Tool; characters: number };
type Assistant = {
  runs: Set<string>;
  input?: number;
  output?: number;
};
type Frame = { assistant: Assistant } | { results: (Result | undefined)[]; otherContent: boolean };

export interface TranscriptCost {
  output: number;
  input: number;
  delegated: boolean;
  incomplete: boolean;
}

function resultFrom(content: unknown, tool: Tool, ids: ReadonlySet<string>): Result | undefined {
  const texts = typeof content === "string" ? [content] : [];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") texts.push(item.text);
    }
  }
  for (const text of texts) {
    const id =
      tool === "delegate"
        ? /^SideTeam ([^\s:]+):/.exec(text)?.[1]
        : /^(?:Applied|Discarded|Cannot apply|Delegation) ([^\s:]+)/.exec(text)?.[1];
    if (id && ids.has(id)) {
      return { id, tool, characters: texts.reduce((length, part) => length + part.length, 0) };
    }
  }
}

async function readSession(file: string, repo: string | null, ids: ReadonlySet<string>) {
  const frames: Frame[] = [];
  const messages = new Map<string, Assistant>();
  const calls = new Map<string, { tool: Tool; assistant: Assistant }>();
  const seenResults = new Set<string>();
  let malformed = 0;
  let scoped = repo === null;
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        malformed++;
        continue;
      }
      const parsed = transcriptEntrySchema.safeParse(json);
      if (!parsed.success) {
        malformed++;
        continue;
      }
      const { type, cwd, message } = parsed.data;
      if (!scoped && cwd && isAbsolute(cwd)) {
        const sessionCwd = await realpath(cwd).catch(() => resolve(cwd));
        if (sessionCwd !== repo) return;
        scoped = true;
      }

      if (!scoped && (type === "assistant" || type === "user")) continue;
      if (type === "assistant") {
        const parsedMessage = assistantMessageSchema.safeParse(message);
        if (!parsedMessage.success) {
          malformed++;
          continue;
        }
        const { id, content, usage } = parsedMessage.data;
        // Streaming snapshots can share a message ID and report cumulative usage.
        let record = id ? messages.get(id) : undefined;
        if (!record) {
          record = { runs: new Set() };
          if (id) messages.set(id, record);
          frames.push({ assistant: record });
        }
        if (usage?.input_tokens !== undefined) {
          record.input =
            usage.input_tokens +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
        }
        record.output = usage?.output_tokens ?? record.output;
        for (const { type, id, name } of content) {
          if (type !== "tool_use" || !id || !name) continue;
          const tool = toolName.exec(name)?.[1] as Tool | undefined;
          if (tool) calls.set(id, { tool, assistant: record });
        }
      } else if (type === "user") {
        const parsedMessage = userMessageSchema.safeParse(message);
        if (!parsedMessage.success) {
          malformed++;
          continue;
        }
        const { content } = parsedMessage.data;
        const results: (Result | undefined)[] = [];
        let otherContent = typeof content === "string";
        if (Array.isArray(content)) {
          for (const { type, tool_use_id, content: payload } of content) {
            if (type !== "tool_result") {
              otherContent = true;
              continue;
            }
            if (tool_use_id) {
              if (seenResults.has(tool_use_id)) continue;
              seenResults.add(tool_use_id);
            }
            const call = tool_use_id ? calls.get(tool_use_id) : undefined;
            const result = call ? resultFrom(payload, call.tool, ids) : undefined;
            if (result && call) call.assistant.runs.add(result.id);
            results.push(result);
          }
        }
        frames.push({ results, otherContent });
      } else if (!metadataTypes.has(type)) {
        malformed++;
      }
    }
  } catch {
    return;
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!scoped) return;
  return { frames, malformed };
}

function accumulateCost(frames: Frame[], costs: Map<string, TranscriptCost>) {
  function costFor(id: string) {
    let cost = costs.get(id);
    if (!cost) {
      cost = { output: 0, input: 0, delegated: false, incomplete: false };
      costs.set(id, cost);
    }
    return cost;
  }

  let previousInput: number | undefined;
  let results: (Result | undefined)[] = [];
  let otherContent = false;

  function chargeResults(nextInput?: number) {
    // A context delta can be attributed to one summary when it is the only new result.
    const delta =
      results.length === 1 &&
      !otherContent &&
      nextInput !== undefined &&
      previousInput !== undefined
        ? nextInput - previousInput
        : -1;
    for (const result of results) {
      if (result?.tool !== "delegate") continue;
      const cost = costFor(result.id);
      cost.delegated = true;
      cost.input += delta >= 0 ? delta : Math.ceil(result.characters / 4);
    }
    results = [];
    otherContent = false;
  }

  for (const frame of frames) {
    if ("assistant" in frame) {
      const { runs, output, input } = frame.assistant;
      chargeResults(input);
      previousInput = input;
      // Allocate the message once, including when it issues several calls for the same run.
      if (!runs.size) continue;
      let remainder = (output ?? 0) % runs.size;
      for (const id of runs) {
        const cost = costFor(id);
        if (output === undefined) cost.incomplete = true;
        else cost.output += Math.floor(output / runs.size) + (remainder-- > 0 ? 1 : 0);
      }
    } else {
      results.push(...frame.results);
      otherContent ||= frame.otherContent;
    }
  }
  chargeResults();
}

export async function readTranscriptCosts(
  directory: string,
  repo: string | null,
  ids: ReadonlySet<string>,
) {
  const costs = new Map<string, TranscriptCost>();
  let readable = 0;
  let malformed = 0;
  const projectName = repo?.replace(/[^a-zA-Z0-9-]/g, "-");
  const projects = await readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const project of projects) {
    if (!project.isDirectory() || (projectName !== undefined && project.name !== projectName)) {
      continue;
    }
    const path = join(directory, project.name);
    const sessions = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const session of sessions) {
      if (!session.isFile() || !session.name.endsWith(".jsonl")) continue;
      const result = await readSession(join(path, session.name), repo, ids);
      if (!result) continue;
      readable++;
      malformed += result.malformed;
      accumulateCost(result.frames, costs);
    }
  }

  return { costs, readable, malformed };
}
