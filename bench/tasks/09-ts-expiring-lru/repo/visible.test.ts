import assert from "node:assert/strict";
import { test } from "node:test";
import { LruCache } from "./cache.ts";

test("a new cache has no entries", () => {
  const cache = new LruCache<string, number>(2, 100);
  assert.equal(cache.get("missing"), undefined);
});
