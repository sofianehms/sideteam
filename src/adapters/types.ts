import type { EngineConfig } from "../config.js";
import type { Command } from "../runner.js";

export interface Job {
  id: string;
  prompt: string;
  promptFile: string;
  worktree: string;
  runDir: string;
  model?: string;
}

export interface RawOutput {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  runDir: string;
  spawnError?: string;
}

export interface EngineResult {
  ok: boolean;
  message: string;
  tokens: { input?: number; output?: number; cached?: number } | null;
  error?: string;
}

export interface CheckResult {
  ok: boolean;
  version?: string;
  message?: string;
}

export interface DetectContext {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  run: (
    bin: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<{ code: number | null; stdout: string }>;
}

export interface DetectResult {
  found: boolean;
  bin?: string;
  version?: string;
  proposal?: { name: string; config: EngineConfig };
  notes?: string[];
}

export interface EngineAdapter {
  name: string;
  check(cfg: EngineConfig): Promise<CheckResult>;
  detect(ctx: DetectContext): Promise<DetectResult>;
  buildCommand(job: Job, cfg: EngineConfig): Command;
  parseResult(raw: RawOutput): EngineResult;
}
