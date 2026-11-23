import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "../options.ts";

test("parses mixed flags and keeps the latest output value", () => {
  assert.deepEqual(parseOptions(["first", "--output=old", "--verbose", "--output", "-", "last"]), {
    verbose: true,
    output: "-",
    files: ["first", "last"],
  });
});
test("preserves option-looking tokens after the delimiter", () => {
  assert.deepEqual(parseOptions(["--output=-draft", "--", "-v", "--", "-"]), {
    verbose: false,
    output: "-draft",
    files: ["-v", "--", "-"],
  });
});
test("rejects unknown options and invalid output values", () => {
  for (const args of [["-x"], ["--unknown"], ["-o"], ["-o", ""], ["--output="], ["-o", "--"]]) {
    assert.throws(() => parseOptions(args), RangeError);
  }
});
