import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { z } from "zod";
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
  .refine((engine) => engine.adapter !== "generic" || engine.command !== undefined, {
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

const fileSchema = z.strictObject({
  default: z.string().optional(),
  check: commandSchema.optional(),
  engines: z.record(z.string(), engineSchema).optional(),
  fallback: z.array(z.string()).optional(),
  dataDir: z.string().optional(),
  worktree: worktreeSchema.optional(),
  limits: limitsSchema.partial().optional(),
});

const configSchema = fileSchema.extend({
  engines: fileSchema.shape.engines.unwrap(),
  worktree: worktreeSchema,
  limits: limitsSchema,
});

export type Config = z.infer<typeof configSchema>;
export type EngineConfig = z.infer<typeof engineSchema>;

export class ConfigError extends Error {
  constructor(file: string, key: string, message: string) {
    super(`${file}: ${key}: ${message}`);
    this.name = "ConfigError";
  }
}

function readConfig(file: string, platform: NodeJS.Platform) {
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
    throw new ConfigError(file, "$", "Malformed JSON");
  }

  const result = fileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const key = issue.code === "unrecognized_keys" ? [...issue.path, issue.keys[0]] : issue.path;
    throw new ConfigError(file, key.join(".") || "$", issue.message);
  }

  const path = platform === "win32" ? win32 : posix;
  if (result.data.dataDir !== undefined && !path.isAbsolute(result.data.dataDir)) {
    result.data.dataDir = path.resolve(path.dirname(file), result.data.dataDir);
  }
  return result.data;
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
  const global = readConfig(globalPath, platform);
  const project = readConfig(projectPath, platform);

  const config: Config = {
    ...global,
    ...project,
    engines: { ...global?.engines, ...project?.engines },
    worktree: { ...global?.worktree, ...project?.worktree },
    limits: { ...defaultLimits, ...global?.limits, ...project?.limits },
  };

  if (config.default !== undefined && !Object.hasOwn(config.engines, config.default)) {
    const file = project?.default === undefined ? globalPath : projectPath;
    throw new ConfigError(file, "default", "Unknown engine");
  }

  for (const [index, name] of (config.fallback ?? []).entries()) {
    if (!Object.hasOwn(config.engines, name)) {
      const file = project?.fallback === undefined ? globalPath : projectPath;
      throw new ConfigError(file, `fallback.${index}`, "Unknown engine");
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
