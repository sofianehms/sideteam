import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { Config } from "./config.js";

export interface PathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function globalConfigPath({
  env = process.env,
  platform = process.platform,
}: PathOptions = {}): string {
  if (platform === "win32") {
    const base = env.APPDATA || win32.join(env.USERPROFILE || homedir(), "AppData", "Roaming");
    return win32.join(base, "sideteam", "config.json");
  }

  const base = env.XDG_CONFIG_HOME || posix.join(env.HOME || homedir(), ".config");
  return posix.join(base, "sideteam", "config.json");
}

export function projectConfigPath(
  repoRoot: string,
  { platform = process.platform }: PathOptions = {},
): string {
  const path = platform === "win32" ? win32 : posix;
  return path.join(repoRoot, ".sideteam.json");
}

export function dataDir(
  config: Pick<Config, "dataDir">,
  { env = process.env, platform = process.platform }: PathOptions = {},
): string {
  const configured = config.dataDir ?? env.CLAUDE_PLUGIN_DATA;
  if (configured !== undefined) {
    return configured;
  }

  if (platform === "win32") {
    const base = env.LOCALAPPDATA || win32.join(env.USERPROFILE || homedir(), "AppData", "Local");
    return win32.join(base, "sideteam");
  }

  const base = env.XDG_DATA_HOME || posix.join(env.HOME || homedir(), ".local", "share");
  return posix.join(base, "sideteam");
}
