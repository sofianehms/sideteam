#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

if (process.argv.includes("--version")) {
  console.log("1.2.3");
  process.exit(0);
}

assert.equal(process.argv[2], "-p");
assert.ok(process.argv.includes("bypassPermissions"));
assert.ok(!existsSync("hidden"));
assert.ok(!existsSync("solution"));
assert.ok(existsSync(".git"));

let calls = 0;
if (process.env.FAKE_CLAUDE_COUNTER) {
  const path = process.env.FAKE_CLAUDE_COUNTER;
  calls = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
  writeFileSync(path, String(calls + 1));
}
if (process.env.FAKE_CLAUDE === "quota" && (!process.env.FAKE_CLAUDE_COUNTER || calls === 2)) {
  console.log(JSON.stringify({ type: "result", is_error: true, result: "Usage limit reached" }));
  process.exit(1);
}

if (process.env.FAKE_CLAUDE === "solve") {
  cpSync(process.env.FAKE_CLAUDE_SOLUTION, ".", { recursive: true });
}
if (process.env.FAKE_CLAUDE === "hang") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (process.env.FAKE_CLAUDE === "meta") {
  const config = JSON.parse(readFileSync(".sideteam.json", "utf8"));
  assert.ok(isAbsolute(config.dataDir));
  assert.ok(process.argv.includes("--plugin-dir"));
  assert.ok(process.argv[3].includes(config.default));
  assert.deepEqual(config.check, ["node", "--test", "visible.test.mjs"]);
  const run = join(config.dataDir, "runs", "st-test");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "meta.json"),
    JSON.stringify({
      tokens: { input: 200, output: 50, cached: 10 },
      model: "engine-test",
    }),
  );
}

console.log(
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done",
    total_cost_usd: 0.03,
    usage: {
      input_tokens: 30,
      output_tokens: 20,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 40,
    },
    modelUsage: { "claude-test": {} },
  }),
);
