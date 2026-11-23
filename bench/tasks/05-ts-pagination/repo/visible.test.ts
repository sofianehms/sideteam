import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate } from "./paginate.ts";

test("rejects page zero and preserves an empty input", () => {
  assert.throws(() => paginate([1], 0, 2), RangeError);
  assert.deepEqual(paginate([], 1, 2), []);
});
