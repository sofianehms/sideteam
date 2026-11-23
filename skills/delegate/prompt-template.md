# Delegation prompt template

## Template

### Objective

<Describe the single requested change in one sentence.>

### Files

<List exact repository-relative paths to modify and the purpose of each edit.>

### Signatures

<List exact function or method signatures, including types. State which signatures to preserve.>

### Constraints

<Describe edge cases, compatibility requirements, and project conventions.>

### Check

Run `<exact project check command>` from the repository root. The change succeeds when the command exits with status 0.

### Prohibitions

<List changes outside the task. Include any restrictions on dependencies, configuration, and network use.>

## Example 1 — Add a function and tests

### Objective

Add a function that returns the number of nonempty lines in a string and test its boundary cases.

### Files

- `src/lines.ts` — add the exported function.
- `tests/lines.test.ts` — add tests for empty input, whitespace-only lines, LF, CRLF, and a final newline.

### Signatures

Implement `export function countNonemptyLines(text: string): number`.

### Constraints

Split lines on LF or CRLF. Count a line only if it contains characters after trimming whitespace. Return zero for empty input.

### Check

Run `npx vitest run tests/lines.test.ts` from the repository root. The command must exit with status 0.

### Prohibitions

Do not edit other files, change existing exports, add dependencies, or use the network.

## Example 2 — Fix page number parsing

### Objective

Fix page number parsing so the search results page falls back to page 1 for invalid query values.

### Files

- `src/pagination.ts` — validate the whole query value before converting it.
- `tests/pagination.test.ts` — add regression cases for invalid input and verify that a valid page is preserved.

### Signatures

Preserve `export function parsePage(value: string | null): number`.

### Constraints

Accept strings of decimal digits that represent positive safe integers, including leading zeros. Return 1 for null, empty input, whitespace, fractions, suffixes such as `2x`, zero, negatives, and out-of-range integers. Preserve the result for valid values such as `"03"`.

### Check

Run `npx vitest run tests/pagination.test.ts` from the repository root. The command must exit with status 0.

### Prohibitions

Do not change callers, add dependencies, edit configuration, or use the network.
