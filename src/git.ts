import { spawn } from "node:child_process";

export class GitError extends Error {
  constructor(
    readonly command: string[],
    readonly code: number | null,
    readonly stderr: string,
    cause?: unknown,
  ) {
    const detail = stderr.trimEnd().split("\n").slice(-10).join("\n");
    super(`git ${command.join(" ")} failed (code ${code})${detail ? `: ${detail}` : ""}`, {
      cause,
    });
    this.name = "GitError";
  }
}

export function git(
  args: string[],
  { cwd, allowFailure = false }: { cwd: string; allowFailure?: boolean },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      stderr += error.message;
      if (!allowFailure) reject(new GitError(args, null, stderr, error));
    });
    child.on("close", (code) => {
      if (code !== 0 && !allowFailure) reject(new GitError(args, code, stderr));
      else resolve({ code, stdout, stderr });
    });
  });
}
