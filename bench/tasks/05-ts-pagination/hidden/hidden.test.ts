import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate } from "../paginate.ts";

test("returns consecutive full pages and the final partial page", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(paginate(items, 1, 2), [1, 2]);
  assert.deepEqual(paginate(items, 2, 2), [3, 4]);
  assert.deepEqual(paginate(items, 3, 2), [5]);
  assert.deepEqual(paginate(items, 4, 2), []);
});
test("handles size one and rejects fractional inputs", () => {
  assert.deepEqual(paginate(["a", "b"], 2, 1), ["b"]);
  assert.throws(() => paginate([1], 1.5, 2), RangeError);
  assert.throws(() => paginate([1], 1, 0), RangeError);
});
