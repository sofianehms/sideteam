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

test("keeps the only model when the discovery header matches an inherited value", async () => {
  const { path, cleanup } = createTmpRepo();
  vi.stubEnv("PATH", path);
  vi.stubEnv("USER", "NAME");
  try {
    await writeFile(join(path, "opencode"), '#!/bin/sh\nprintf "1.2.3\\n"\n', { mode: 0o755 });
    await writeFile(join(path, "ollama"), '#!/bin/sh\nprintf "NAME\\nmodel-a\\n"\n', {
      mode: 0o755,
    });
    expect(JSON.parse(await inspectEngines({ detect: true }, path))).toMatchObject({
      engines: { local: { model: "ollama/model-a" } },
    });
  } finally {
    vi.unstubAllEnvs();
    cleanup();
  }
});

test("omits a detection proposal derived from an inherited variable value", async () => {
  const { path, cleanup } = createTmpRepo();
  vi.stubEnv("PATH", path);
  vi.stubEnv("USER", "sample-private-model");
  try {
    await writeFile(join(path, "opencode"), '#!/bin/sh\nprintf "1.2.3\\n"\n', { mode: 0o755 });
    const executable = join(path, "ollama");
    await writeFile(executable, '#!/bin/sh\nprintf "NAME\\npublic-model\\n"\n', { mode: 0o755 });
    expect(JSON.parse(await inspectEngines({ detect: true }, path))).toMatchObject({
      engines: { local: { model: "ollama/public-model" } },
    });

    await writeFile(executable, '#!/bin/sh\nprintf "NAME\\n%s\\n" "$USER"\n');
    expect(JSON.parse(await inspectEngines({ detect: true }, path))).toEqual({ engines: {} });
  } finally {
    vi.unstubAllEnvs();
    cleanup();
  }
});

test.each([
  { user: "dev", model: "ollama/qwen3-coder:latest" },
  { user: "devstral:latest", model: "ollama/qwen3-coder:latest" },
  { user: "qwen3-coder:latest", model: "ollama/devstral:latest" },
])("keeps unaffected detection entries when USER=$user", async ({ user, model }) => {
  const { path, cleanup } = createTmpRepo();
  vi.stubEnv("PATH", path);
  vi.stubEnv("USER", user);
  try {
    await writeFile(join(path, "opencode"), '#!/bin/sh\nprintf "1.2.3\\n"\n', { mode: 0o755 });
    await writeFile(
      join(path, "ollama"),
      '#!/bin/sh\nprintf "NAME\\ndevstral:latest\\nqwen3-coder:latest\\n"\n',
      { mode: 0o755 },
    );
    const output = await inspectEngines({ detect: true }, path);
    expect(JSON.parse(output)).toMatchObject({ engines: { local: { model } } });
    if (user.includes(":")) expect(output).not.toContain(user);
  } finally {
    vi.unstubAllEnvs();
    cleanup();
  }
});

test.each([
  { variable: "TEST_SETTING", env: ["TEST_SETTING"], output: "stderr" },
  { variable: "USER", env: undefined, output: "stderr" },
  { variable: "USER", env: undefined, output: "version" },
])("redacts $variable from executable $output", async ({ variable, env, output }) => {
  const { path, cleanup } = createTmpRepo();
  const setting = "987.654.321+sample";
  vi.stubEnv("XDG_CONFIG_HOME", path);
  vi.stubEnv("APPDATA", path);
  vi.stubEnv(variable, setting);
  const script =
    output === "stderr"
      ? "console.error(process.env[process.argv[1]]); process.exit(1)"
      : "console.log(process.env[process.argv[1]])";
  try {
    await writeFile(
      join(path, ".sideteam.json"),
      JSON.stringify({
        engines: {
          checked: {
            adapter: "codex",
            bin: [process.execPath, "-e", script, "--", variable],
            env,
          },
        },
      }),
    );
    const text = await inspectEngines({}, path);
    const status = output === "stderr" ? "no | - | [redacted]" : "yes | [redacted] | -";
    expect(text).toContain(`checked | codex | - | cloud | yes | ${status}`);
    expect(text).not.toContain(setting);
  } finally {
    vi.unstubAllEnvs();
    cleanup();
  }
});
