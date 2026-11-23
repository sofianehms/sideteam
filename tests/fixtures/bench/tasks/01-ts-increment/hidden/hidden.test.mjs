import assert from "node:assert/strict";
import test from "node:test";
import { increment } from "../increment.mjs";

test("increments a negative number", () => assert.equal(increment(-2), -1));
