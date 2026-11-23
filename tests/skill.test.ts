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
  expect(skill).toMatch(/^Read the diff before calling apply\.(?: |\r?$)/m);
});

test("requires passing the selected engine on every delegation", () => {
  expect(skill).toContain('Choose an engine with `privacy: "local"` for confidential code.');
  expect(skill).toContain(
    "Pass the selected engine name as `engine` on every `delegate` call, including retries.",
  );
});

test("includes content under each required heading in both prompt examples", () => {
  const examples = template.split(/^## Example \d+[^\r\n]*\r?\n/m).slice(1);
  expect(examples).toHaveLength(2);
  for (const example of examples) {
    const sections = example.split(/^### (.+)\r?\n/m);
    for (const heading of ["Objective", "Files", "Signatures", "Check", "Prohibitions"]) {
      const index = sections.findIndex((section, index) => index % 2 === 1 && section === heading);
      expect(index, heading).toBeGreaterThan(0);
      expect(sections[index + 1]?.trim(), heading).toBeTruthy();
    }
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
