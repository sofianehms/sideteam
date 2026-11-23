import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../slugify.ts";

test("collapses runs and trims separators", () => {
  assert.equal(slugify("  Release__42 / NOW! "), "release-42-now");
});
test("returns an empty slug for input without ASCII letters or digits", () => {
  assert.equal(slugify("éK!?"), "");
});
