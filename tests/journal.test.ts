import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runDelegation } from "../src/delegate.js";
import { appendEvent, readEvents } from "../src/journal.js";
import { createTmpRepo } from "./helpers/tmp-repo.js";

test("appends events and counts malformed lines without dropping later events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sideteam-journal-"));
  const ts = "2026-11-21T12:00:00.000Z";
  const apply = { type: "apply", ts, id: "st-1" } as const;
  const discard = { type: "discard", ts, id: "st-2" } as const;
  try {
    expect(await readEvents(dir)).toEqual({ events: [], malformed: 0 });
    await appendEvent(dir, apply);
    await appendFile(join(dir, "journal.jsonl"), '{broken\n{"type":"apply"}\n\n');
    await appendEvent(dir, discard);
    expect(await readEvents(dir)).toEqual({ events: [apply, discard], malformed: 3 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journals only metadata after a delegation whose engine echoes its prompt and environment", async () => {
  const repo = createTmpRepo();
  const dataDir = join(repo.path, ".sideteam", "data");
  const prompt = "Private instruction for the journal fixture";
  const secret = "synthetic-value-for-journal-privacy";
  const script = [
    "const fs = require('node:fs');",
    "fs.writeFileSync('README.md', 'Updated README\\n');",
    "console.log(fs.readFileSync(process.argv[1], 'utf8'));",
    "console.log(process.env.SIDETEAM_TEST_SECRET);",
  ].join(" ");
  try {
    await writeFile(
      join(repo.path, ".sideteam.json"),
      JSON.stringify({
        dataDir,
        engines: {
          fixture: {
            adapter: "generic",
            command: [process.execPath, "-e", script, "{prompt_file}"],
            env: ["SIDETEAM_TEST_SECRET"],
          },
        },
        check: [process.execPath, "-e", "process.exit(0)"],
      }),
    );
    const result = await runDelegation(
      { prompt },
      {
        env: {
          CLAUDE_PROJECT_DIR: repo.path,
          XDG_CONFIG_HOME: join(repo.path, "config"),
          SIDETEAM_TEST_SECRET: secret,
        },
      },
    );
    expect(result.structured.status).toBe("success");
    const log = await readFile(result.structured.logPath, "utf8");
    expect(log).toContain(prompt);
    expect(log).toContain(secret);

    const journal = await readFile(join(dataDir, "journal.jsonl"), "utf8");
    expect(journal).not.toContain(prompt);
    expect(journal).not.toContain(secret);
    expect(journal).not.toContain("SIDETEAM_TEST_SECRET");
    expect(JSON.parse(journal)).toEqual({
      type: "delegation",
      ts: expect.any(String),
      id: result.structured.id,
      repo: expect.stringContaining("sideteam-repo-"),
      engine: "fixture",
      adapter: "generic",
      model: null,
      status: "success",
      attempts: 1,
      durationMs: expect.any(Number),
      files: 1,
      added: 1,
      deleted: 1,
      tokens: null,
    });
  } finally {
    repo.cleanup();
  }
});
