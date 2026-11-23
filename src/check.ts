import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { run } from "./runner.js";

const operators = new Set(["&&", "||", "|", ";", ">", "<"]);

export function parseCommand(value: string | string[]): string[] {
  if (Array.isArray(value)) return value;

  const args: string[] = [];
  let quote: string | undefined;
  let part: string | undefined;

  for (const char of value) {
    if (quote) {
      if (char === quote) quote = undefined;
      else part += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      part ??= "";
    } else if (/\s/.test(char)) {
      if (part !== undefined) args.push(part);
      part = undefined;
    } else {
      part = (part ?? "") + char;
    }
  }
  if (quote) throw new Error("command contains an unterminated quote");
  if (part !== undefined) args.push(part);
  if (args.some((arg) => operators.has(arg))) {
    throw new Error("command must be a single program; wrap it in a package script");
  }
  return args;
}

export async function runCommandIn(
  worktree: string,
  value: string | string[],
  { timeoutMs, logFile, lines }: { timeoutMs: number; logFile: string; lines: number },
) {
  const [bin, ...args] = parseCommand(value);
  if (!bin) throw new Error("command must specify a program");

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const { code, timedOut, durationMs } = await run(
    { bin, args, cwd: worktree, env },
    { timeoutMs, logFile },
  );

  let tail: string[] = [];
  if (lines > 0) {
    const input = createReadStream(logFile);
    const reader = createInterface({ input, crlfDelay: Infinity });
    let count = 0;
    reader.on("error", () => {}); // The stream error is reported by finished().
    reader.on("line", (line) => {
      tail[count % lines] = line;
      count += 1;
    });
    await finished(input);
    if (count > lines) {
      const start = count % lines;
      tail = tail.slice(start).concat(tail.slice(0, start));
    }
  }
  return { passed: code === 0 && !timedOut, code, timedOut, durationMs, tail };
}
