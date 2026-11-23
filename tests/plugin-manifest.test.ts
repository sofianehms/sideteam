import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

function read(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

test("declares the plugin with the package version", () => {
  const manifest = JSON.parse(read("../.claude-plugin/plugin.json"));
  const pkg = JSON.parse(read("../package.json"));
  expect(manifest).toMatchObject({ name: "sideteam", version: pkg.version });
});

test("lists only the root plugin in the marketplace", () => {
  const marketplace = JSON.parse(read("../.claude-plugin/marketplace.json"));
  expect(marketplace.name).toBe("sideteam");
  expect(marketplace.plugins).toEqual([{ name: "sideteam", source: "./" }]);
});

test("launches the bundled server with Node", () => {
  const manifest = JSON.parse(read("../.mcp.json"));
  expect(manifest.mcpServers.sideteam).toMatchObject({
    command: "node",
    args: [`\${CLAUDE_PLUGIN_ROOT}/dist/sideteam.js`],
  });
});

test("guides engine detection and requires confirmation before overwriting", () => {
  const command = read("../commands/setup.md");
  expect(command).toMatch(/^---\r?\ndescription: \S[^\r\n]*\r?\n---\r?\n/);
  expect(command).toMatch(/`engines` tool with `\{"detect": true\}`/);
  expect(command).toMatch(/show the diff and get explicit user confirmation before overwriting/i);
  expect(command).toContain("Call `engines` again with `{}`");
});
