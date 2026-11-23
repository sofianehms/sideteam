import assert from "node:assert/strict";
import { test } from "node:test";
import { LruCache } from "../cache.ts";

test("expiry takes precedence over recency and reads do not renew TTL", () => {
  let time = 0;
  const cache = new LruCache<string, number>(2, 10, () => time);
  cache.set("old", 1);
  time = 5;
  cache.set("live", 2);
  assert.equal(cache.get("old"), 1);
  time = 10;
  cache.set("new", 3);
  assert.equal(cache.get("old"), undefined);
  assert.equal(cache.get("live"), 2);
  assert.equal(cache.get("new"), 3);
});
test("replacing a value refreshes both expiry and recency", () => {
  let time = 0;
  const cache = new LruCache<string, number>(2, 10, () => time);
  cache.set("a", 1);
  cache.set("b", 2);
  time = 9;
  cache.set("a", 4);
  cache.set("c", 3);
  time = 10;
  assert.equal(cache.get("a"), 4);
  assert.equal(cache.get("b"), undefined);
  time = 19;
  assert.equal(cache.get("a"), undefined);
});
test("rejects invalid constructor arguments", () => {
  assert.throws(() => new LruCache(1.5, 10), RangeError);
  assert.throws(() => new LruCache(1, Infinity), RangeError);
  assert.throws(() => new LruCache(1, 0), RangeError);
});
