import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "./slugify.ts";

test("lowercases and joins two words", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});
