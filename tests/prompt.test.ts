import { expect, test } from "vitest";
import { framePrompt } from "../src/prompt.js";

test("frames the instruction with context files and fixed rules", () => {
  const prompt = "Update the usage examples.\nKeep the current layout.";
  const text = framePrompt({ prompt, files: ["README.md", "src/index.ts"], check: "npm test" });
  expect(text).toContain(prompt);
  expect(text).toContain("Context files:\n- README.md\n- src/index.ts");
  expect(text).toContain("Work only in the current folder.");
  expect(text).toContain("Do not push.");
  expect(text).toContain("Do not modify files unrelated to the task.");
  expect(text).toContain("The check command npm test will be run afterwards.");
});

test("preserves arguments and supports an unconfigured check", () => {
  const input = { prompt: "Update usage.", files: [] };
  expect(framePrompt({ ...input, check: ["npm", "run", "my check"] })).toContain(
    'The check command ["npm","run","my check"] will be run afterwards.',
  );
  const text = framePrompt(input);
  expect(text).toContain("Context files:\nNone");
  expect(text).not.toContain("will be run afterwards");
});
