import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function buildOptions(outfile) {
  return {
    absWorkingDir: projectRoot,
    entryPoints: ["src/index.ts"],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    minify: false,
    banner: {
      js: [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
      ].join("\n"),
    },
    define: {
      __SIDETEAM_VERSION__: JSON.stringify(version),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(buildOptions(process.argv[2] ?? "dist/sideteam.js"));
}
