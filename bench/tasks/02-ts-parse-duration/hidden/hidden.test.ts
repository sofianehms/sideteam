import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../duration.ts";

test("adds adjacent units in any order", () => {
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("15s2h0m"), 7215);
});
test("rejects malformed or unsafe durations", () => {
  for (const value of ["", "1h 2m", "1.5h", "2m3m", "1hx", "1h\n", "9007199254740992s"]) {
    assert.throws(() => parseDuration(value), RangeError, value);
  }
});
