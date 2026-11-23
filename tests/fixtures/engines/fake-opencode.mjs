import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("1.2.3");
} else {
  const [run, modelFlag, model, formatFlag, format, dirFlag, dir, auto] = args;
  assert.deepEqual(
    [run, modelFlag, formatFlag, format, dirFlag, auto],
    ["run", "-m", "--format", "json", "--dir", "--auto"],
  );
  assert.match(model, /^ollama\/.+/);
  assert.equal(realpathSync(dir), realpathSync(process.cwd()));
  assert.ok(args.length > 8);
  assert.equal(readFileSync(0, "utf8"), "");
  assert.equal(
    Object.keys(process.env).some((key) => /^OPENCODE_/i.test(key)),
    false,
  );
  writeFileSync(join(dir, "received-prompt.txt"), args.at(-1));
  const failed = process.env.FAKE_MODE === "fail";
  const fixture = new URL(`../opencode/run-${failed ? "error" : "success"}.jsonl`, import.meta.url);
  process.stdout.write(readFileSync(fixture));
  if (failed) process.exitCode = 1;
}
