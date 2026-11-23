import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli 1.2.3");
  process.exit(0);
}

function value(flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index < args.length - 2 ? args[index + 1] : undefined;
}

const worktree = value("-C");
const output = value("-o");
if (
  args[0] !== "exec" ||
  value("-s") !== "workspace-write" ||
  !worktree ||
  !args.includes("--json") ||
  !output ||
  args.at(-1) !== "-"
) {
  process.exit(2);
}

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;

const failed = process.env.FAKE_MODE === "fail";
const fixture = failed ? "exec-failure.jsonl" : "exec-success.jsonl";
process.stdout.write(await readFile(new URL(`../codex/${fixture}`, import.meta.url), "utf8"));

if (failed) {
  process.exitCode = 1;
} else {
  await writeFile(join(worktree, "received-prompt.txt"), prompt);
  await writeFile(output, "Finished from file.");
}
