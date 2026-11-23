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
