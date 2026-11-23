import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTask, loadTasks, type Task } from "./lib/tasks.js";

function checkDistribution(tasks: Task[]): void {
  if (tasks.length !== 12) throw new Error(`Expected 12 tasks, found ${tasks.length}`);
  for (const level of ["easy", "medium", "hard"]) {
    if (tasks.filter((task) => task.level === level).length !== 4) {
      throw new Error(`Expected four ${level} tasks`);
    }
    for (const language of ["ts", "py"]) {
      if (
        tasks.filter((task) => task.level === level && task.language === language && task.light)
          .length !== 1
      ) {
        throw new Error(`Expected one light ${level} ${language} task`);
      }
    }
  }
  for (const language of ["ts", "py"]) {
    if (tasks.filter((task) => task.language === language).length !== 6) {
      throw new Error(`Expected six ${language} tasks`);
    }
  }
}

function check(cwd: string, [bin, ...args]: Task["check"], expected: number, label: string): void {
  const result = spawnSync(bin === "node" ? process.execPath : bin, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== expected) {
    throw new Error(
      `${label}: expected exit ${expected}, got ${result.signal ?? result.status}\n${result.stdout}${result.stderr}`.trimEnd(),
    );
  }
}

function validate(task: Task, scratch: string): void {
  const start = join(scratch, "start");
  const solution = join(scratch, "solution");
  try {
    copyTask(task, start, { withSolution: false, withHidden: true });
    copyTask(task, solution, { withSolution: true, withHidden: false });
    check(start, task.hidden, 1, "hidden tests must fail on start");
    console.log(`${task.id}: hidden fails on start`);
    check(solution, task.check, 0, "visible check must pass on solution");
    console.log(`${task.id}: visible check passes on solution`);
    copyTask(task, join(scratch, "hidden-solution"), { withSolution: true, withHidden: true });
    check(join(scratch, "hidden-solution"), task.hidden, 0, "hidden tests must pass on solution");
    console.log(`${task.id}: hidden passes on solution`);
  } catch (error) {
    throw new Error(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--expect-complete")) {
    throw new Error("Usage: npm run bench:validate -- [--expect-complete]");
  }
  const tasks = loadTasks(fileURLToPath(new URL("../tasks/", import.meta.url)));
  if (args.length === 1) checkDistribution(tasks);
  if (tasks.some((task) => task.language === "ts")) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 18)) {
      throw new Error("TypeScript tasks require Node.js 22.18 or newer");
    }
  }
  for (const task of tasks) {
    const scratch = mkdtempSync(fileURLToPath(new URL("./task-", import.meta.url)));
    try {
      validate(task, scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  console.log(`Validated ${tasks.length} tasks.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
