import { access, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { inspectEngines } from "../src/tools/engines.js";
import { connectMcpClient } from "./helpers/mcp-client.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

const fakeEngine = fileURLToPath(new URL("./fixtures/engines/fake-codex.mjs", import.meta.url));

async function callEngines(path: string, args: { detect?: boolean } = {}, pathEnv?: string) {
  const client = await connectMcpClient(path, {
    XDG_CONFIG_HOME: path,
    APPDATA: path,
    ...(pathEnv === undefined ? {} : { PATH: pathEnv }),
  });
  try {
    const result = await client.callTool({ name: "engines", arguments: args });
    expect(result.isError).not.toBe(true);
    if (!("content" in result)) throw new Error("Expected tool content");
    const [content] = result.content;
    if (content?.type !== "text") throw new Error("Expected text content");
    return content.text;
  } finally {
    await client.close();
  }
}

test("lists four configured engines, including an installed and a missing executable", async () => {
  const { path, cleanup } = createTmpRepo();
  try {
    const configFile = join(path, ".sideteam.json");
    await writeFile(
      configFile,
      JSON.stringify({
        default: "present",
        engines: {
          present: {
            adapter: "codex",
            bin: [process.execPath, fakeEngine],
            model: "example",
            privacy: "local",
          },
          missing: { adapter: "codex", bin: join(path, "missing"), privacy: "cloud" },
          another: { adapter: "generic", command: [process.execPath] },
          fourth: { adapter: "generic", command: [process.execPath] },
        },
      }),
    );
    const text = await callEngines(path);
    expect(text).toContain("present | codex | example | local | yes | yes | 1.2.3");
    expect(text).toContain("missing | codex | - | cloud | no | no | - |");
    expect(text).toContain("another | generic | - | cloud | no | yes");
    expect(text).toContain("fourth | generic | - | cloud | no | yes");
    expect(text).toContain(`Configuration files read: ${await realpath(configFile)}`);
    expect(text.length).toBeLessThan(2_000);
  } finally {
    cleanup();
  }
});

test("reports invalid configuration as text", async () => {
  const { path, cleanup } = createTmpRepo();
  try {
    await writeFile(join(path, ".sideteam.json"), '{"engines":');
    expect(await callEngines(path)).toMatch(
      /Configuration error: .*\.sideteam\.json: engines: Malformed JSON/,
    );
  } finally {
    cleanup();
  }
});

test("returns a detection proposal that loads once saved", async () => {
  const { path, cleanup } = createTmpRepo();
  try {
    const configFile = join(path, ".sideteam.json");
    await writeFile(join(path, "codex"), '#!/bin/sh\nprintf "codex-cli 1.2.3\\n"\n', {
      mode: 0o755,
    });
    await writeFile(join(path, "package.json"), '{"scripts":{"test":"example"}}');
    const text = await callEngines(path, { detect: true }, path);
    await expect(access(configFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(text)).toEqual({
      default: "codex",
      engines: { codex: { adapter: "codex" } },
      check: "npm test",
    });
    await writeFile(configFile, text);
    const { config, sources } = loadConfig({
      repoRoot: path,
      env: { XDG_CONFIG_HOME: path, APPDATA: path },
    });
    expect(config).toMatchObject({
      default: "codex",
      engines: { codex: { adapter: "codex", privacy: "cloud" } },
      check: "npm test",
    });
    expect(sources).toEqual([configFile]);
  } finally {
    cleanup();
  }
});

test("redacts configured variable values from executable diagnostics", async () => {
  const { path, cleanup } = createTmpRepo();
  const setting = "sample-sensitive-setting";
  vi.stubEnv("XDG_CONFIG_HOME", path);
  vi.stubEnv("APPDATA", path);
  vi.stubEnv("TEST_SETTING", setting);
  try {
    await writeFile(
      join(path, ".sideteam.json"),
      JSON.stringify({
        engines: {
          broken: {
            adapter: "codex",
            bin: [
              process.execPath,
              "-e",
              "console.error(process.env.TEST_SETTING ?? ''); process.exit(1)",
              "--",
            ],
            env: ["TEST_SETTING"],
          },
        },
      }),
    );
    const text = await inspectEngines({}, path);
    expect(text).toContain("broken | codex | - | cloud | yes | no | - |");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain(setting);
  } finally {
    vi.unstubAllEnvs();
    cleanup();
  }
});
