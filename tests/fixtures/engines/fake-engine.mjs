import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const [
  mode = process.env.FAKE_MODE,
  file = process.env.FAKE_FILE,
  content = process.env.FAKE_CONTENT,
] = process.argv.slice(2);

switch (mode) {
  case "edit-on-2nd": {
    const state = process.env.FAKE_STATE;
    const count = (existsSync(state) ? Number(readFileSync(state, "utf8")) : 0) + 1;
    writeFileSync(state, String(count));
    if (count === 2 && readFileSync(file, "utf8") !== "wrong") {
      throw new Error("The first attempt's edit did not survive");
    }
    writeFileSync(file, count === 2 ? content : "wrong");
    break;
  }
  case "edit":
    writeFileSync(file, content);
    break;
  case "fail":
    console.error("Fixture failed");
    process.exitCode = 3;
    break;
  case "noop":
    break;
  case "hang-hard":
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    break;
  case "hang":
    setInterval(() => {}, 1000);
    break;
  case "child": {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    // Stay alive long enough to reap the grandchild when the group receives SIGTERM.
    process.on("SIGTERM", () => {});
    console.log(child.pid);
    break;
  }
  case "flood":
    for (let index = 0; index < 20; index += 1) {
      const chunk = Buffer.alloc(1024 * 1024, "x");
      await new Promise((resolve, reject) => {
        process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    }
    break;
  case "env":
    console.log(Object.keys(process.env).sort().join("\n"));
    break;
  case "stdin":
    await pipeline(process.stdin, createWriteStream(process.env.FAKE_FILE));
    break;
  default:
    throw new Error("Unknown fixture mode");
}
