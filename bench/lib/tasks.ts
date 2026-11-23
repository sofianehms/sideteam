import { cpSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const commandSchema = z.tuple([z.string().trim().min(1)], z.string());

export const taskSchema = z.strictObject({
  id: z.string().regex(/^\d{2}-(ts|py)-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  level: z.enum(["easy", "medium", "hard"]),
  language: z.enum(["ts", "py"]),
  light: z.boolean(),
  prompt: z.string().trim().min(1),
  check: commandSchema,
  hidden: commandSchema,
});

export type Task = z.infer<typeof taskSchema> & { directory: string };

export function loadTasks(dir: string): Task[] {
  const root = resolve(dir);
  const tasks: Task[] = [];
  const numbers = new Set<string>();
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    try {
      const metadata = taskSchema.parse(
        JSON.parse(readFileSync(join(directory, "task.json"), "utf8")),
      );
      if (metadata.id !== entry.name || metadata.id.split("-")[1] !== metadata.language) {
        throw new Error("id, directory name and language must agree");
      }
      const number = metadata.id.slice(0, 2);
      if (numbers.has(number)) throw new Error(`Duplicate task number ${number}`);
      for (const name of ["repo", "hidden", "solution"]) {
        if (!statSync(join(directory, name)).isDirectory()) {
          throw new Error(`${name}/ must be a directory`);
        }
      }
      numbers.add(number);
      tasks.push({ ...metadata, directory });
    } catch (error) {
      throw new Error(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return tasks;
}

export function copyTask(
  task: Task,
  dest: string,
  { withSolution, withHidden }: { withSolution: boolean; withHidden: boolean },
): void {
  mkdirSync(dest, { recursive: true });
  cpSync(join(task.directory, "repo"), dest, { recursive: true });
  if (withSolution) cpSync(join(task.directory, "solution"), dest, { recursive: true });
  if (withHidden) cpSync(join(task.directory, "hidden"), join(dest, "hidden"), { recursive: true });
}
