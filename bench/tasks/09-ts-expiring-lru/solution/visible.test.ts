import assert from "node:assert/strict";
import { test } from "node:test";
import { LruCache } from "./cache.ts";

test("a new cache has no entries", () => {
  const cache = new LruCache<string, number>(2, 100);
  assert.equal(cache.get("missing"), undefined);
});

test("a read promotes an entry and capacity evicts the least recently used", () => {
  const cache = new LruCache<string, number>(2, 100, () => 0);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
});
test("an entry expires exactly at its deadline", () => {
  let time = 0;
  const cache = new LruCache<string, number>(1, 10, () => time);
  cache.set("a", 1);
  time = 9;
  assert.equal(cache.get("a"), 1);
  time = 10;
  assert.equal(cache.get("a"), undefined);
});
