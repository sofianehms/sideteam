import { accessSync, constants, statSync } from "node:fs";
import { extname, isAbsolute, resolve, win32 } from "node:path";
import type { EngineConfig } from "../config.js";

export function resolveBin(
  cfg: EngineConfig,
  defaultBin: string,
): { bin: string; prefix: string[] } {
  const [bin, ...prefix] = Array.isArray(cfg.bin) ? cfg.bin : [cfg.bin ?? defaultBin];
  if (!bin) throw new Error("bin must specify a program");
  return { bin, prefix };
}

export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  if (!name) return undefined;
  const windows = platform === "win32";
  const variable = (key: string) =>
    windows ? env[Object.keys(env).find((name) => name.toUpperCase() === key) ?? key] : env[key];
  const extensions =
    windows && !extname(name)
      ? (variable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  const path = variable("PATH");
  const candidates =
    isAbsolute(name) || (windows && win32.isAbsolute(name))
      ? [name]
      : name.includes("/") || (windows && name.includes("\\"))
        ? []
        : (path?.split(windows ? ";" : ":") ?? []).map((dir) => resolve(dir, name));

  for (const candidate of candidates) {
    for (const extension of extensions) {
      const file = candidate + extension;
      try {
        if (!statSync(file).isFile()) continue;
        accessSync(file, windows ? constants.F_OK : constants.X_OK);
        return file;
      } catch {
        // Continue with the next candidate.
      }
    }
  }
  return undefined;
}
