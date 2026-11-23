import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { DetectContext, EngineAdapter } from "../src/adapters/types.js";
import { detectAll, guessCheck } from "../src/detect.js";

function adapter(name: string, detect: EngineAdapter["detect"]): EngineAdapter {
  return { name, detect, check: vi.fn(), buildCommand: vi.fn(), parseResult: vi.fn() };
}

const env = { TEST_SETTING: "example-value-not-for-output" };
const run = vi.fn<DetectContext["run"]>();
const context = { env, platform: process.platform, run };

test("aggregates only found proposals and carries variable names", async () => {
  const config = { adapter: "first", env: ["TEST_SETTING"] };
  const found = adapter("first", async (input) => {
    expect(input).toEqual(context);
    return { found: true, proposal: { name: "primary", config } };
  });
  const absent = adapter("second", async () => ({ found: false }));

  const result = await detectAll({ ...context, adapters: [found, absent] });
  expect(result).toEqual({ default: "primary", engines: { primary: config } });
  expect(JSON.stringify(result)).not.toContain(env.TEST_SETTING);
});

test("starts detection concurrently and chooses the first proposal in registry order", async () => {
  const firstConfig = { adapter: "first" };
  const secondConfig = { adapter: "second" };
  let finishFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const first = adapter("first", async () => {
    await firstCanFinish;
    return { found: true, proposal: { name: "primary", config: firstConfig } };
  });
  const second = adapter("second", async () => {
    finishFirst();
    return { found: true, proposal: { name: "secondary", config: secondConfig } };
  });

  await expect(detectAll({ ...context, adapters: [first, second] })).resolves.toEqual({
    default: "primary",
    engines: { primary: firstConfig, secondary: secondConfig },
  });
});

test.each([
  ["package.json", '{"scripts":{"test":"example"}}', "npm test"],
  ["pyproject.toml", "", "pytest"],
  ["pytest.ini", "", "pytest"],
  ["Cargo.toml", "", "cargo test"],
  ["go.mod", "", "go test ./..."],
  ["package.json", '{"scripts":{"build":"example"}}', undefined],
  ["README.md", "", undefined],
])("guesses the check for %s", (file, contents, check) => {
  const repoRoot = mkdtempSync(join(tmpdir(), "sideteam-check-"));
  try {
    writeFileSync(join(repoRoot, file), contents);
    expect(guessCheck(repoRoot)).toBe(check);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
