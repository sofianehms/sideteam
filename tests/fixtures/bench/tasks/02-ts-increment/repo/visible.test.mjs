import assert from "node:assert/strict";
import test from "node:test";
import { increment } from "./increment.mjs";

test("increments a positive number", () => assert.equal(increment(2), 3));
