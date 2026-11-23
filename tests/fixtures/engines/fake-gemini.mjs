import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("1.2.3");
} else {
  assert.deepEqual(args.slice(0, 6), [
    "-p",
    "Follow the task given on standard input.",
    "-o",
    "json",
    "--approval-mode",
    "yolo",
  ]);

  const prompt = readFileSync(0, "utf8");
  assert.ok(prompt.length > 0);
  assert.equal(
    args.some((arg) => arg.includes(prompt)),
    false,
  );
  assert.equal(Object.hasOwn(process.env, "GEMINI_API_KEY"), false);
  writeFileSync("received-prompt.txt", prompt);

  const exit = Number(process.env.FAKE_EXIT ?? 0);
  assert.ok([0, 42, 53].includes(exit));
  const fixture = new URL(`../gemini/${exit ? "error" : "success"}.json`, import.meta.url);
  process.stdout.write(readFileSync(fixture));
  process.exitCode = exit;
}
