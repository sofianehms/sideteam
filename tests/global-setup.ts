import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import type { TestProject } from "vitest/node";
import { buildOptions } from "../scripts/build.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    bundle: string;
  }
}

export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), "sideteam-test-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const bundle = join(directory, "sideteam.js");
    await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
    await build(buildOptions(bundle));
    project.provide("bundle", bundle);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
