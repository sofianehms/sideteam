import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ConfigError, effectiveLinks, loadConfig, resolveTimeoutMinutes } from "../src/config.js";
import { dataDir, globalConfigPath, projectConfigPath } from "../src/paths.js";

let directory: string;
let repoRoot: string;
let env: NodeJS.ProcessEnv;
let globalFile: string;
let projectFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(process.cwd(), ".sideteam-config-test-"));
  repoRoot = join(directory, "project");
  env = {
    XDG_CONFIG_HOME: join(directory, "config"),
    CLAUDE_PLUGIN_DATA: join(directory, "plugin"),
  };
  mkdirSync(join(env.XDG_CONFIG_HOME ?? "", "sideteam"), { recursive: true });
  mkdirSync(repoRoot);
  globalFile = globalConfigPath({ env, platform: "linux" });
  projectFile = projectConfigPath(repoRoot, { platform: "linux" });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function writeConfig(file: string, config: object) {
  writeFileSync(file, JSON.stringify(config));
}

function load() {
  return loadConfig({ repoRoot, env, platform: "linux" });
}

test("uses the exact defaults when both files are missing", () => {
  expect(load()).toEqual({
    config: {
      engines: {},
      worktree: {},
      limits: {
        timeoutMinutes: 20,
        checkTimeoutMinutes: 10,
        diffLines: 150,
        checkLines: 40,
        maxSummaryChars: 8000,
      },
    },
    sources: [],
  });
});

test("loads only the global file and accepts a free adapter name", () => {
  writeConfig(globalFile, {
    engines: { custom: { adapter: "external-adapter" } },
    default: "custom",
  });
  const { config, sources } = load();
  expect(sources).toEqual([globalFile]);
  expect(config.engines).toEqual({ custom: { adapter: "external-adapter", privacy: "cloud" } });
  expect(config.default).toBe("custom");
});

test("loads only the project file and infers a single engine as the default", () => {
  writeConfig(projectFile, {
    engines: { local: { adapter: "generic", command: ["runner"], privacy: "local" } },
  });
  const { config, sources } = load();
  expect(sources).toEqual([projectFile]);
  expect(config.default).toBe("local");
  expect(config.engines.local).toEqual({
    adapter: "generic",
    command: ["runner"],
    privacy: "local",
  });
});

test("merges engines by name and gives the project default precedence", () => {
  writeConfig(globalFile, { engines: { codex: { adapter: "codex" } }, default: "codex" });
  writeConfig(projectFile, { engines: { local: { adapter: "ollama" } }, default: "local" });
  const { config, sources } = load();
  expect(sources).toEqual([globalFile, projectFile]);
  expect(Object.keys(config.engines)).toEqual(["codex", "local"]);
  expect(config.default).toBe("local");
});

test("replaces engine entries and arrays, and merges limits and worktree by key", () => {
  writeConfig(globalFile, {
    engines: { runner: { adapter: "generic", command: ["global"] } },
    check: ["global"],
    fallback: ["runner"],
    limits: { timeoutMinutes: 25, checkLines: 30 },
    worktree: { setup: "prepare", link: ["global"] },
  });
  writeConfig(projectFile, {
    engines: { runner: { adapter: "replacement" } },
    check: ["project"],
    fallback: [],
    limits: { checkLines: 50 },
    worktree: { link: ["project"] },
  });
  const { config } = load();
  expect(config.engines.runner).toEqual({ adapter: "replacement", privacy: "cloud" });
  expect(config.check).toEqual(["project"]);
  expect(config.fallback).toEqual([]);
  expect(config.limits).toMatchObject({ timeoutMinutes: 25, checkLines: 50, diffLines: 150 });
  expect(config.worktree).toEqual({ setup: "prepare", link: ["project"] });
});

test("validates engine references against the merged engines", () => {
  writeConfig(globalFile, { default: "local", fallback: ["local"] });
  writeConfig(projectFile, { engines: { local: { adapter: "ollama" } } });
  expect(load().config).toMatchObject({ default: "local", fallback: ["local"] });
});

test.each([
  [{ unexpected: true }, "unexpected"],
  [{ limits: { unexpected: true } }, "limits.unexpected"],
  [{ worktree: { unexpected: true } }, "worktree.unexpected"],
  [{ engines: { local: { adapter: "runner", unexpected: true } } }, "engines.local.unexpected"],
  [{ engines: { local: { adapter: 123 } } }, "engines.local.adapter"],
  [{ engines: { local: { adapter: "generic" } } }, "engines.local.command"],
  [{ default: "missing" }, "default"],
  [{ fallback: ["missing"] }, "fallback.0"],
])("rejects invalid configuration %j at %s", (input, key) => {
  writeConfig(projectFile, input);
  expect(load).toThrow(ConfigError);
  expect(load).toThrow(`${projectFile}: ${key}:`);
});

test("attributes an inherited invalid reference to the global file", () => {
  writeConfig(globalFile, { fallback: ["missing"] });
  writeConfig(projectFile, { engines: { local: { adapter: "ollama" } } });
  expect(load).toThrow(`${globalFile}: fallback.0:`);
});

test("reports the file and root location for malformed JSON", () => {
  writeFileSync(globalFile, "{");
  expect(load).toThrow(ConfigError);
  expect(load).toThrow(`${globalFile}: $: Malformed JSON`);
});

test.each(["linux", "darwin"] as const)("uses XDG paths and home defaults on %s", (platform) => {
  const options = { platform, env: { HOME: "/users/dev" } };
  expect(globalConfigPath(options)).toBe("/users/dev/.config/sideteam/config.json");
  expect(projectConfigPath("/repo", options)).toBe("/repo/.sideteam.json");
  expect(dataDir({}, options)).toBe("/users/dev/.local/share/sideteam");

  const xdg = { platform, env: { XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data" } };
  expect(globalConfigPath(xdg)).toBe("/config/sideteam/config.json");
  expect(dataDir({}, xdg)).toBe("/data/sideteam");
});

test("uses Windows path conventions and application data directories", () => {
  const options = {
    platform: "win32",
    env: { APPDATA: "C:\\Roaming", LOCALAPPDATA: "D:\\Local", XDG_CONFIG_HOME: "/ignored" },
  } as const;
  expect(globalConfigPath(options)).toBe("C:\\Roaming\\sideteam\\config.json");
  expect(projectConfigPath("C:\\repo", options)).toBe("C:\\repo\\.sideteam.json");
  expect(dataDir({}, options)).toBe("D:\\Local\\sideteam");
});

test("resolves relative data directories from the declaring file before applying precedence", () => {
  const options = { env, platform: "linux" } as const;
  expect(dataDir(load().config, options)).toBe(env.CLAUDE_PLUGIN_DATA);

  writeConfig(globalFile, { dataDir: "../global-data" });
  writeConfig(projectFile, { check: "test" });
  expect(dataDir(load().config, options)).toBe(join(directory, "config", "global-data"));

  writeConfig(projectFile, { dataDir: "project-data" });
  expect(dataDir(load().config, options)).toBe(join(repoRoot, "project-data"));

  const absolute = join(directory, "absolute-data");
  writeConfig(projectFile, { dataDir: absolute });
  expect(dataDir(load().config, options)).toBe(absolute);
});

test("uses default links, skips them for setup alone, and honors explicit links", () => {
  expect(effectiveLinks(load().config)).toEqual(["node_modules", ".venv"]);
  writeConfig(projectFile, { worktree: { setup: ["prepare"] } });
  expect(effectiveLinks(load().config)).toEqual([]);
  writeConfig(projectFile, { worktree: { setup: ["prepare"], link: ["dependencies"] } });
  expect(effectiveLinks(load().config)).toEqual(["dependencies"]);
  writeConfig(projectFile, { worktree: { link: [] } });
  expect(effectiveLinks(load().config)).toEqual([]);
});

test.each([
  "deps/../outside",
  "deps\\..\\outside",
  "/absolute",
  "C:\\absolute",
  "C:relative",
])("rejects unsafe link %s", (link) => {
  writeConfig(projectFile, { worktree: { link: [link] } });
  expect(load).toThrow(`${projectFile}: worktree.link.0:`);
});

test("resolves timeout from the call, then the engine, then the configured limits", () => {
  const { limits } = load().config;
  expect(resolveTimeoutMinutes(5, { timeoutMinutes: 30 }, limits)).toBe(5);
  expect(resolveTimeoutMinutes(undefined, { timeoutMinutes: 30 }, limits)).toBe(30);
  expect(resolveTimeoutMinutes(undefined, {}, limits)).toBe(limits.timeoutMinutes);
});

test.each([
  ['{"engines":{"runner":{"adapter":oops}}}', "engines.runner.adapter"],
  ['{"worktree":{"link":["deps",]}}', "worktree.link.1"],
  ['{"limits":{"checkLines" 40}}', "limits.checkLines"],
  ['{"engines":{"r\\u0075nner":{"args":["ok","\\q"]}}}', "engines.runner.args.1"],
  ['{"check":"ok"} trailing', "$"],
])("reports malformed JSON at the nearest known path %s (%s)", (contents, key) => {
  writeFileSync(projectFile, contents);
  expect(load).toThrow(ConfigError);
  expect(load).toThrow(`${projectFile}: ${key}: Malformed JSON`);
});

test("validates replacements after merging simple fields and each merged section", () => {
  writeConfig(globalFile, {
    check: 42,
    fallback: [42],
    dataDir: false,
    engines: { runner: { adapter: "generic" } },
    worktree: { link: ["../outside"] },
    limits: { checkLines: false },
  });
  writeConfig(projectFile, {
    check: "verify",
    fallback: ["runner"],
    dataDir: "data",
    engines: { runner: { adapter: "custom" } },
    worktree: { link: ["deps"] },
    limits: { checkLines: 50 },
  });
  expect(load().config).toMatchObject({
    check: "verify",
    fallback: ["runner"],
    dataDir: join(repoRoot, "data"),
    engines: { runner: { adapter: "custom" } },
    worktree: { link: ["deps"] },
    limits: { checkLines: 50 },
  });
});

test.each([
  [{ check: 42 }, {}, "check", true],
  [{ check: "verify" }, { check: 42 }, "check", false],
  [{ engines: { runner: { adapter: 42 } } }, { engines: {} }, "engines.runner.adapter", true],
  [{ worktree: { link: [".."] } }, { worktree: { setup: "prepare" } }, "worktree.link.0", true],
  [{ limits: { diffLines: "bad" } }, { limits: { checkLines: 50 } }, "limits.diffLines", true],
  [{ limits: { diffLines: 150 } }, { limits: { diffLines: "bad" } }, "limits.diffLines", false],
  [{ limits: { diffLines: 150 } }, { limits: null }, "limits", false],
  [{ worktree: [] }, { worktree: undefined }, "worktree", true],
] as const)("attributes the surviving invalid input %j with project %j", (global, project, key, inherited) => {
  writeConfig(globalFile, global);
  writeConfig(projectFile, project);
  expect(load).toThrow(`${inherited ? globalFile : projectFile}: ${key}:`);
});

test("allows a project object to replace a malformed global section", () => {
  writeConfig(globalFile, { limits: ["invalid"] });
  writeConfig(projectFile, { limits: { timeoutMinutes: 37 } });
  const { limits } = load().config;
  expect(resolveTimeoutMinutes(undefined, undefined, limits)).toBe(37);
  expect(limits.checkLines).toBe(40);
});
