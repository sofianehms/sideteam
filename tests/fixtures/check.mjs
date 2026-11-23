import { readFileSync } from "node:fs";

const [file, expected] = process.argv.slice(2);
if (!readFileSync(file, "utf8").split("\n").includes(expected)) process.exitCode = 1;
