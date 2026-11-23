import type { Config } from "./config.js";

const instructionSeparator = "\n\nInstruction:\n";

export function promptInstruction(framed: string): string {
  const start = framed.indexOf(instructionSeparator);
  return start === -1 ? framed : framed.slice(start + instructionSeparator.length);
}

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
  return (
    [
      "Rules:",
      "- Work only in the current folder.",
      "- Do not push.",
      "- Do not modify files unrelated to the task.",
      ...(command === undefined ? [] : [`- The check command ${command} will be run afterwards.`]),
      "",
      "Context files:",
      ...(files.length ? files.map((file) => `- ${file}`) : ["None"]),
    ].join("\n") +
    instructionSeparator +
    prompt
  );
}
