import assert from "node:assert/strict";
import { test } from "node:test";
import { overlaps } from "./overlap.ts";

test("recognizes partial overlap", () => {
  assert.equal(overlaps({ start: new Date(1), end: new Date(3) },
                        { start: new Date(2), end: new Date(4) }), true);
});
