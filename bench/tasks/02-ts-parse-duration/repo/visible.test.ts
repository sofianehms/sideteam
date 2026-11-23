import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "./duration.ts";

test("converts a single unit", () => {
  assert.equal(parseDuration("5m"), 300);
});
