import type { Config } from "./config.js";

export function framePrompt({
  prompt,
  files,
  check,
}: {
  prompt: string;
  files: readonly string[];
  check?: Config["check"];
}): string {
  const command = typeof check === "string" ? check : JSON.stringify(check);
  return [
    "Rules:",
    "- Work only in the current folder.",
    "- Do not push.",
    "- Do not modify files unrelated to the task.",
    ...(command === undefined ? [] : [`- The check command ${command} will be run afterwards.`]),
    "",
    "Context files:",
    ...(files.length ? files.map((file) => `- ${file}`) : ["None"]),
    "",
    "Instruction:",
    prompt,
  ].join("\n");
}
