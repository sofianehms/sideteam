import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { connectMcpClient } from "./helpers/mcp-client.js";

const skill = readFileSync(new URL("../skills/delegate/SKILL.md", import.meta.url), "utf8");
const template = readFileSync(
  new URL("../skills/delegate/prompt-template.md", import.meta.url),
  "utf8",
);

test("declares bounded delegation skill metadata and links to its template", () => {
  const header = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1] ?? "";
  expect(header).toMatch(/^name: delegate\r?$/m);
  const description = header.match(/^description: ([^\r\n]+)\r?$/m)?.[1].trim() ?? "";
  expect(description.length).toBeGreaterThan(0);
  expect(description.length).toBeLessThanOrEqual(1024);
  expect(skill.replace(/\r?\n$/, "").split(/\r?\n/).length).toBeLessThan(300);
  expect(skill).toContain("](prompt-template.md)");
});

test("documents all delegation statuses and requires diff review before applying", () => {
  for (const status of ["success", "check_failed", "engine_failed", "timeout"]) {
    expect(skill).toContain(`\`${status}\``);
  }
  expect(skill).toContain("Read the diff before calling apply");
});

test("includes the required headings in each prompt example", () => {
  const examples = template.split(/^## Example \d+[^\r\n]*\r?\n/m).slice(1);
  expect(examples).toHaveLength(2);
  for (const example of examples) {
    const headings = [...example.matchAll(/^### (.+)\r?$/gm)].map(([, heading]) => heading.trim());
    expect(headings).toEqual(
      expect.arrayContaining(["Objective", "Files", "Signatures", "Check", "Prohibitions"]),
    );
  }
});

test("documents the four delegation tools registered by the stdio server", async () => {
  const client = await connectMcpClient(process.cwd());
  try {
    const registeredTools = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of ["delegate", "apply", "discard", "engines"]) {
      expect(skill).toContain(`\`${name}\``);
      expect(registeredTools).toContain(name);
    }
  } finally {
    await client.close();
  }
});
