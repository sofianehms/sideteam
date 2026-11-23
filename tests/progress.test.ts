import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, expect, test, vi } from "vitest";
import { runCommandIn } from "../src/check.js";
import { run } from "../src/runner.js";
import { registerDelegate } from "../src/tools/delegate.js";

vi.mock("node:fs/promises", () => ({ realpath: async (path: string) => path, writeFile: vi.fn() }));
vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    config: {
      default: "fixture",
      engines: { fixture: { adapter: "generic", command: ["fixture"] } },
      check: ["check"],
      retries: 1,
      worktree: { setup: ["setup"] },
      limits: { checkTimeoutMinutes: 10, timeoutMinutes: 20, maxSummaryChars: 8000 },
    },
  }),
  effectiveLinks: () => [],
  resolveTimeoutMinutes: () => 20,
}));
vi.mock("../src/git.js", () => ({
  git: async (args: string[]) =>
    args[0] === "diff" ? { code: 1 } : { code: 0, stdout: "/repo\n" },
}));
vi.mock("../src/worktree.js", () => ({
  newId: () => "st-fixture",
  createWorktree: async () => ({ path: "/repo/wt", base: "base", branch: "branch", linked: [] }),
  commitAll: async () => true,
  changes: async () => ({ files: [], diff: "", commits: 1 }),
}));
vi.mock("../src/runs.js", () => ({
  createRunDir: async () => "/runs",
  publishRunArtifacts: vi.fn(),
  writeMeta: vi.fn(),
}));
vi.mock("../src/check.js", () => ({
  parseCommand: (value: string[]) => value,
  runCommandIn: vi.fn(),
}));
vi.mock("../src/runner.js", () => ({ run: vi.fn() }));

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

afterEach(() => vi.useRealTimers());

test.each([
  true,
  false,
])("sends continuous progress across a retry only when requested (%s)", async (requested) => {
  let checks = 0;
  vi.mocked(runCommandIn).mockImplementation(async (_cwd, [command]) => {
    const durationMs = command === "setup" ? 35_000 : 30_000;
    await delay(durationMs);
    const passed = command === "setup" || ++checks === 2;
    return { passed, code: passed ? 0 : 1, timedOut: false, durationMs, tail: [] };
  });
  vi.mocked(run).mockImplementation(async () => {
    await delay(30_000);
    return {
      code: 0,
      signal: null,
      timedOut: false,
      durationMs: 30_000,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
    };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = vi.spyOn(serverTransport, "send");
  const client = new Client({ name: "progress-test", version: "0.0.0" });
  const server = new McpServer({ name: "sideteam", version: "0.0.0" });
  registerDelegate(server);

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const onprogress = vi.fn();
    const result = client.callTool(
      { name: "delegate", arguments: { prompt: "Make a change" } },
      { timeout: 180_000, ...(requested ? { onprogress } : {}) },
    );
    const progress = () =>
      send.mock.calls.flatMap(([message]) =>
        "method" in message && message.method === "notifications/progress"
          ? [message.params?.progress]
          : [],
      );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(progress()).toEqual([]);
    const ticks = [30, 60, 90, 120, 150];
    for (const seconds of ticks) {
      await vi.advanceTimersByTimeAsync(seconds === 30 ? 1 : 30_000);
      expect(progress()).toEqual(requested ? ticks.filter((value) => value <= seconds) : []);
    }
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await result).structuredContent).toMatchObject({
      status: "success",
      durationMs: 155_000,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(progress()).toEqual(requested ? ticks : []);
    expect(onprogress).toHaveBeenCalledTimes(requested ? ticks.length : 0);
  } finally {
    await client.close();
    await server.close();
  }
});
