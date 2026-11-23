import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { hasRequiredCommand } from "./adapters/generic.js";
import { globalConfigPath, type PathOptions, projectConfigPath } from "./paths.js";

const commandSchema = z.union([z.string(), z.array(z.string())]);
const engineSchema = z
  .strictObject({
    adapter: z.string(),
    model: z.string().optional(),
    bin: commandSchema.optional(),
    args: z.array(z.string()).optional(),
    command: z.array(z.string()).optional(),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    env: z.array(z.string()).optional(),
    privacy: z.enum(["local", "cloud"]).default("cloud"),
    timeoutMinutes: z.number().positive().optional(),
  })
  .refine(hasRequiredCommand, {
    path: ["command"],
    message: "Required for the generic adapter",
  });

const linkSchema = z
  .string()
  .refine(
    (link) =>
      !posix.isAbsolute(link) &&
      !win32.isAbsolute(link) &&
      !/^[a-z]:/i.test(link) &&
      !link.split(/[\\/]/).includes(".."),
    "Expected a relative path without parent segments",
  );

const worktreeSchema = z.strictObject({
  link: z.array(linkSchema).optional(),
  setup: commandSchema.optional(),
});

const limitsSchema = z.strictObject({
  timeoutMinutes: z.number(),
  checkTimeoutMinutes: z.number(),
  diffLines: z.number(),
  checkLines: z.number(),
  maxSummaryChars: z.number(),
});

const defaultLimits = {
  timeoutMinutes: 20,
  checkTimeoutMinutes: 10,
  diffLines: 150,
  checkLines: 40,
  maxSummaryChars: 8000,
};

const configSchema = z.strictObject({
  default: z.string().optional(),
  check: commandSchema.optional(),
  engines: z.record(z.string(), engineSchema),
  fallback: z.array(z.string()).optional(),
  retries: z.number().int().min(0).max(3).default(1),
  dataDir: z.string().optional(),
  worktree: worktreeSchema,
  limits: limitsSchema,
});

export type Config = z.infer<typeof configSchema>;
export type EngineConfig = z.input<typeof engineSchema>;

export class ConfigError extends Error {
  constructor(file: string, key: string, message: string) {
    super(`${file}: ${key}: ${message}`);
    this.name = "ConfigError";
  }
}

// JSON.parse remains the parser. On failure, walk the tokens to locate the faulty value.
function malformedKey(contents: string): string {
  const whitespace = /[ \t\r\n]*/y;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: JSON strings reject unescaped control characters.
  const string = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/y;
  const scalar = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const key: (string | number)[] = [];
  let offset = 0;

  function token(pattern: RegExp): string | undefined {
    whitespace.lastIndex = offset;
    whitespace.exec(contents);
    pattern.lastIndex = whitespace.lastIndex;
    const match = pattern.exec(contents);
    if (match) offset = pattern.lastIndex;
    return match?.[0];
  }

  function value(): boolean {
    if (token(/\{/y)) {
      if (token(/\}/y)) return true;
      for (;;) {
        const name = token(string);
        if (name === undefined) return false;
        key.push(JSON.parse(name));
        if (!token(/:/y) || !value()) return false;
        if (token(/\}/y)) {
          key.pop();
          return true;
        }
        if (!token(/,/y)) return false;
        key.pop();
      }
    }

    if (token(/\[/y)) {
      if (token(/\]/y)) return true;
      for (let index = 0; ; index++) {
        key.push(index);
        if (!value()) return false;
        if (token(/\]/y)) {
          key.pop();
          return true;
        }
        if (!token(/,/y)) return false;
        key.pop();
      }
    }

    return token(string) !== undefined || token(scalar) !== undefined;
  }

  try {
    value();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return key.join(".") || "$";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfig(file: string): Record<string, unknown> | undefined {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new ConfigError(file, "$", "Unable to read configuration file");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConfigError(file, malformedKey(contents), "Malformed JSON");
  }
  if (!isObject(parsed)) throw new ConfigError(file, "$", "Expected an object");
  return parsed;
}

function mergeSection(global: unknown, project: unknown, defaults = {}) {
  const selected = project === undefined ? global : project;
  if (selected !== undefined && !isObject(selected)) return selected;
  return { ...defaults, ...(isObject(global) ? global : {}), ...selected };
}

export function loadConfig({
  repoRoot,
  env,
  platform = process.platform,
}: PathOptions & { repoRoot: string }): {
  config: Config;
  sources: string[];
} {
  const globalPath = globalConfigPath({ env, platform });
  const projectPath = projectConfigPath(repoRoot, { platform });
  const global = readConfig(globalPath);
  const project = readConfig(projectPath);

  const merged = {
    ...global,
    ...project,
    engines: mergeSection(global?.engines, project?.engines),
    worktree: mergeSection(global?.worktree, project?.worktree),
    limits: mergeSection(global?.limits, project?.limits, defaultLimits),
  };

  function sourceFor(key: PropertyKey[]): string {
    const [section, field] = key;
    const projectSection = project?.[String(section)];
    const fromProject =
      field !== undefined && ["engines", "worktree", "limits"].includes(String(section))
        ? isObject(projectSection) && Object.hasOwn(projectSection, field)
        : project !== undefined && Object.hasOwn(project, section);
    return fromProject ? projectPath : globalPath;
  }

  function invalid(key: PropertyKey[], message: string): never {
    throw new ConfigError(sourceFor(key), key.join(".") || "$", message);
  }

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    const issue = result.error.issues[0];
    const key = issue.code === "unrecognized_keys" ? [...issue.path, issue.keys[0]] : issue.path;
    invalid(key, issue.message);
  }
  const config = result.data;
  const path = platform === "win32" ? win32 : posix;
  if (config.dataDir !== undefined && !path.isAbsolute(config.dataDir)) {
    const file = sourceFor(["dataDir"]);
    config.dataDir = path.resolve(path.dirname(file), config.dataDir);
  }

  if (config.default !== undefined && !Object.hasOwn(config.engines, config.default)) {
    invalid(["default"], "Unknown engine");
  }

  for (const [index, name] of (config.fallback ?? []).entries()) {
    if (!Object.hasOwn(config.engines, name)) {
      invalid(["fallback", index], "Unknown engine");
    }
  }

  const names = Object.keys(config.engines);
  if (config.default === undefined && names.length === 1) {
    config.default = names[0];
  }

  return {
    config,
    sources: [...(global ? [globalPath] : []), ...(project ? [projectPath] : [])],
  };
}

export function effectiveLinks({ worktree }: Pick<Config, "worktree">): string[] {
  return worktree.link ?? (worktree.setup === undefined ? ["node_modules", ".venv"] : []);
}

export function resolveTimeoutMinutes(
  callValue: number | undefined,
  engineCfg: Pick<EngineConfig, "timeoutMinutes"> | undefined,
  limits: Pick<Config["limits"], "timeoutMinutes">,
): number {
  return callValue ?? engineCfg?.timeoutMinutes ?? limits.timeoutMinutes;
}
