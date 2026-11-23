import type { DelegationStatus } from "./summary.js";

export function buildChain(selected: string, fallback: readonly string[] = []): string[] {
  return [...new Set([selected, ...fallback])];
}

export function retryPrompt(prompt: string, checkTail: readonly string[]): string {
  return [prompt, "", "Previous check output:", ...checkTail, "", "Fix the failing check."].join(
    "\n",
  );
}

export function nextAction(
  status: DelegationStatus,
  attempt: number,
  retries: number,
  hasFallback: boolean,
): "stop" | "retry" | "fallback" {
  if (status === "success") return "stop";
  if (status === "check_failed" && attempt <= retries) return "retry";
  return hasFallback ? "fallback" : "stop";
}
