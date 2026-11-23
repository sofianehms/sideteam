import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { buildOptions } from "./build.mjs";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "sideteam-dist-"));
try {
  const candidate = join(temporaryDirectory, "sideteam.js");
  await build(buildOptions(candidate));

  const current = await readFile(new URL("../dist/sideteam.js", import.meta.url)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });

  if (!current || !current.equals(await readFile(candidate))) {
    console.error("dist/sideteam.js is missing or out of date: run npm run build");
    process.exitCode = 1;
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
