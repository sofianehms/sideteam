import { expect, test } from "vitest";
import { type DelegationOutcome, renderSummary } from "../src/summary.js";

const limits = { diffLines: 150, checkLines: 40, maxSummaryChars: 8000 };
const outcome: DelegationOutcome = {
  id: "abc123",
  status: "success",
  engine: "local",
  model: "example",
  durationMs: 123,
  files: [],
  base: "dev",
  diff: "",
  logPath: "/runs/abc123/engine.log",
};

test.each([
  ["success", "apply"],
  ["check_failed", "discard"],
  ["engine_failed", "discard"],
  ["timeout", "discard"],
] as const)("includes the identifier, status and next step for %s", (status, action) => {
  const { text, structured } = renderSummary({ ...outcome, status }, limits);
  expect(text).toContain(`SideTeam abc123: ${status.toUpperCase()}`);
  expect(text).toContain(`Next step: ${action} abc123`);
  expect(text).toContain("Engine: local | Model: example | Duration: 123 ms");
  expect(text).toContain("Raw log: /runs/abc123/engine.log");
  expect(structured).toMatchObject({ id: "abc123", status, nextStep: `${action} abc123` });
});

test("displays the reason and caps the file list and engine message", () => {
  const { text, structured } = renderSummary(
    {
      ...outcome,
      status: "engine_failed",
      reason: "Process exited early",
      files: Array.from({ length: 52 }, (_, index) => ({
        path: `file-${index}`,
        added: 3,
        deleted: 2,
      })),
      engineMessage: "x".repeat(2000),
    },
    limits,
  );
  expect(text).toContain("Reason: Process exited early");
  expect(text).toContain("file-49 +3 -2\n… and 2 more");
  expect(text).not.toContain("file-50");
  expect(structured.files).toHaveLength(50);
  expect(structured.omittedFiles).toBe(2);
  expect(structured.engineMessage).toHaveLength(1500);
  expect(text).toContain(structured.engineMessage);
});

test("keeps the first 150 diff lines and the last 40 check lines", () => {
  const diff = Array.from({ length: 5000 }, (_, index) => `change-${index}`);
  const tail = Array.from({ length: 2000 }, (_, index) => `check-${index}`);
  const { text, structured } = renderSummary(
    {
      ...outcome,
      diff: `${diff.join("\n")}\n`,
      check: { command: ["npm", "test"], code: 2, tail },
    },
    limits,
  );
  expect(text.length).toBeLessThanOrEqual(8000);
  expect(text).toContain('Check: ["npm","test"] (code: 2)');
  expect(text).toContain(`Check output:\n${tail.slice(-40).join("\n")}\n`);
  expect(text).toContain(`Diff:\n${diff.slice(0, 150).join("\n")}\n`);
  expect(text).toContain(
    "[diff truncated: 150 of 5000 lines; full diff: git diff dev..sideteam/abc123]",
  );
  expect(structured.diff.split("\n")).toEqual(diff.slice(0, 150));
  expect(structured.check?.tail).toEqual(tail.slice(-40));
});

test("reduces the diff first and then drops the oldest check lines under the character cap", () => {
  const diff = Array.from(
    { length: 5000 },
    (_, index) => `change-${index} ${"x".repeat(200)}`,
  ).join("\n");
  const tail = Array.from({ length: 2000 }, (_, index) => `check-${index}`);
  const check = { command: "npm test", code: 0, tail };
  const first = renderSummary({ ...outcome, diff, check }, limits);
  expect(first.text.length).toBeLessThanOrEqual(8000);
  expect(first.structured.diff).not.toBe("");
  expect(first.structured.diff.split("\n").length).toBeLessThan(150);
  expect(first.structured.check?.tail).toEqual(tail.slice(-40));

  const longTail = tail.map((line) => `${line} ${"x".repeat(400)}`);
  const second = renderSummary({ ...outcome, diff, check: { ...check, tail: longTail } }, limits);
  expect(second.text.length).toBeLessThanOrEqual(8000);
  expect(second.structured.diff).toBe("");
  expect(second.text).toContain("[diff truncated: 0 of 5000 lines;");
  const kept = second.structured.check?.tail ?? [];
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.length).toBeLessThan(40);
  expect(kept).toEqual(longTail.slice(-kept.length));
});

test.each([
  "success",
  "check_failed",
  "engine_failed",
  "timeout",
] as const)("rejects an insufficient cap and accepts an exact fit for %s", (status) => {
  const input = { ...outcome, status };
  const { text } = renderSummary(input, limits);
  expect(() => renderSummary(input, { ...limits, maxSummaryChars: 25 })).toThrow(RangeError);
  expect(() => renderSummary(input, { ...limits, maxSummaryChars: text.length - 1 })).toThrow(
    /too small for the required summary fields/,
  );
  expect(renderSummary(input, { ...limits, maxSummaryChars: text.length }).text).toBe(text);
});

test.each([
  { command: "npm test", code: 2, label: "npm test (code: 2)" },
  { command: ["npm", "test"], code: null, label: '["npm","test"] (code: unavailable)' },
])("keeps required fields and reports the same files under pressure ($label)", (testCheck) => {
  const files = Array.from({ length: 52 }, (_, index) => ({
    path: `file-${index}-${"x".repeat(215)}`,
    added: 3,
    deleted: 2,
  }));
  const check = { command: testCheck.command, code: testCheck.code, tail: ["failed"] };
  const { text, structured } = renderSummary(
    { ...outcome, files, check, diff: "first\nsecond" },
    { ...limits, diffLines: 1 },
  );
  const kept = structured.files.length;
  expect(text.length).toBeLessThanOrEqual(8000);
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(50);
  expect(structured.files).toEqual(files.slice(0, kept));
  expect(structured.omittedFiles).toBe(files.length - kept);
  const fileList = structured.files.map(
    ({ path, added, deleted }) => `${path} +${added} -${deleted}`,
  );
  expect(text).toContain(
    ["Files:", ...fileList, `… and ${files.length - kept} more`, `Check: ${testCheck.label}`].join(
      "\n",
    ),
  );
  expect(structured.check).toEqual({ command: check.command, code: check.code, tail: [] });
  expect(structured.diff).toBe("");
  expect(structured.diffNote).toBe(
    "[diff truncated: 0 of 2 lines; full diff: git diff dev..sideteam/abc123]",
  );
  expect(text).toContain(structured.diffNote);
});

test("keeps a short full diff when the truncation note cannot fit", () => {
  const check = { command: "npm test", code: 0, tail: [] };
  const input = { ...outcome, diff: "change", check };
  const expected = renderSummary(input, limits);
  const actual = renderSummary(
    { ...input, check: { ...check, tail: ["x".repeat(100)] } },
    { ...limits, maxSummaryChars: expected.text.length },
  );
  expect(actual).toEqual(expected);
});
