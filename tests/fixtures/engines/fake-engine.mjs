import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";

switch (process.env.FAKE_MODE) {
  case "edit":
    writeFileSync(process.env.FAKE_FILE, process.env.FAKE_CONTENT);
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
