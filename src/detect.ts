import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectContext, EngineAdapter } from "./adapters/types.js";
import type { EngineConfig } from "./config.js";

export async function detectAll({
  adapters,
  env,
  platform,
  run,
}: DetectContext & { adapters: readonly EngineAdapter[] }): Promise<{
  engines: Record<string, EngineConfig>;
  default?: string;
}> {
  const results = await Promise.allSettled(
    adapters.map(async (adapter) => adapter.detect({ env, platform, run })),
  );
  const proposals = new Map<string, EngineConfig>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.found) continue;
    const proposal = result.value.proposal;
    if (proposal && !proposals.has(proposal.name)) proposals.set(proposal.name, proposal.config);
  }
  const first = proposals.keys().next().value;
  return {
    ...(first === undefined ? {} : { default: first }),
    engines: Object.fromEntries(proposals),
  };
}

export function guessCheck(repoRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    if (typeof pkg?.scripts?.test === "string") return "npm test";
  } catch {
    // A missing or unreadable manifest does not prevent checking the other project markers.
  }
  if (existsSync(join(repoRoot, "pyproject.toml")) || existsSync(join(repoRoot, "pytest.ini"))) {
    return "pytest";
  }
  if (existsSync(join(repoRoot, "Cargo.toml"))) return "cargo test";
  if (existsSync(join(repoRoot, "go.mod"))) return "go test ./...";
  return undefined;
}
