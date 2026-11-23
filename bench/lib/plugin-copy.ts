import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildEngineEnv } from "../../src/env.js";
import { run } from "../../src/runner.js";

export async function copyPlugin(root: string, scratch: string, signal?: AbortSignal) {
  const plugin = join(scratch, "plugin");
  mkdirSync(plugin);
  const npm = process.env.npm_execpath;
  const result = await run(
    {
      bin: npm ? process.execPath : "npm",
      args: [...(npm ? [npm] : []), "run", "build", "--", join(plugin, "dist", "sideteam.js")],
      cwd: root,
      env: buildEngineEnv([]),
    },
    { timeoutMs: 120_000, logFile: join(scratch, "build.log"), signal },
  );
  signal?.throwIfAborted();
  if (result.code !== 0) {
    throw new Error(`Plugin build failed: ${result.spawnError ?? result.stderr}`);
  }
  for (const name of [".claude-plugin", ".mcp.json", "skills", "commands", "package.json"]) {
    cpSync(join(root, name), join(plugin, name), { recursive: true });
  }
  return plugin;
}
