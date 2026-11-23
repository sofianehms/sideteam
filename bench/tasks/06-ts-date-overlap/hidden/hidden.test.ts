import assert from "node:assert/strict";
import { test } from "node:test";
import { overlaps } from "../overlap.ts";

const interval = (start: number, end: number) => ({ start: new Date(start), end: new Date(end) });

test("excludes boundaries and empty intervals", () => {
  assert.equal(overlaps(interval(1, 3), interval(3, 5)), false);
  assert.equal(overlaps(interval(2, 2), interval(1, 5)), false);
});
test("checks reversed and invalid endpoints", () => {
  assert.throws(() => overlaps(interval(2, 2), interval(3, 1)), RangeError);
  assert.throws(() => overlaps(interval(1, 5), interval(1, NaN)), RangeError);
});
