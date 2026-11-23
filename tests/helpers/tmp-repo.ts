import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTmpRepo() {
  const path = mkdtempSync(join(tmpdir(), "sideteam-repo-"));
  const cleanup = () => rmSync(path, { recursive: true, force: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: path });

  try {
    git("init", "-b", "main");
    git("config", "--local", "user.name", "SideTeam Tests");
    git("config", "--local", "user.email", "sideteam-test@example.invalid");
    git("config", "--local", "commit.gpgsign", "false");
    writeFileSync(join(path, "README.md"), "# Test repository\n");
    git("add", "README.md");
    git("commit", "-m", "Initial commit");
    return { path, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
