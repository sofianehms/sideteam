import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "./options.ts";

test("returns defaults and retains positional arguments", () => {
  assert.deepEqual(parseOptions(["first", "-"]), {
    verbose: false,
    output: undefined,
    files: ["first", "-"],
  });
});

test("supports short options and stops at the delimiter", () => {
  assert.deepEqual(parseOptions(["-v", "-o", "out", "--", "--verbose"]), {
    verbose: true,
    output: "out",
    files: ["--verbose"],
  });
});
test("rejects a missing output path", () => {
  assert.throws(() => parseOptions(["--output", "--verbose"]), RangeError);
});
