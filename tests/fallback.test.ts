import { expect, test } from "vitest";
import { buildChain, nextAction, retryPrompt } from "../src/fallback.js";

test("keeps the selected engine first and removes repeated engines", () => {
  expect(buildChain("first", ["local", "first", "remote", "local"])).toEqual([
    "first",
    "local",
    "remote",
  ]);
  expect(buildChain("first")).toEqual(["first"]);
});

test("appends the check output and a correction request to the original prompt", () => {
  expect(retryPrompt("Original prompt", ["line 1", "line 2"])).toBe(
    "Original prompt\n\nPrevious check output:\nline 1\nline 2\n\nFix the failing check.",
  );
});

test.each([
  ["success", 1, 1, true, "stop"],
  ["check_failed", 1, 1, true, "retry"],
  ["check_failed", 1, 1, false, "retry"],
  ["check_failed", 2, 1, true, "fallback"],
  ["check_failed", 2, 1, false, "stop"],
  ["check_failed", 1, 0, true, "fallback"],
  ["check_failed", 1, 0, false, "stop"],
  ["engine_failed", 1, 3, true, "fallback"],
  ["engine_failed", 1, 3, false, "stop"],
  ["timeout", 1, 3, true, "fallback"],
  ["timeout", 1, 3, false, "stop"],
] as const)("%s on attempt %i with %i retries and fallback %s gives %s", (status, attempt, retries, fallback, action) => {
  expect(nextAction(status, attempt, retries, fallback)).toBe(action);
});
