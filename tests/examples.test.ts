import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const directory = new URL("../examples/config/", import.meta.url);
const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();

test("includes both local presets", () => {
  expect(files).toEqual(expect.arrayContaining(["codex-oss.json", "ollama-opencode.json"]));
});

test.each(files)("loads %s through the configuration schema", async (file) => {
  const repoRoot = await mkdtemp(join(tmpdir(), "sideteam-example-"));
  try {
    const path = join(repoRoot, ".sideteam.json");
    await copyFile(new URL(file, directory), path);
    const { config, sources } = loadConfig({
      repoRoot,
      env: { HOME: repoRoot, XDG_CONFIG_HOME: repoRoot, APPDATA: repoRoot, USERPROFILE: repoRoot },
    });
    expect(sources).toEqual([path]);
    expect(Object.keys(config.engines).length).toBeGreaterThan(0);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
