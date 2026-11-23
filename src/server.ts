import { McpServer } from "@modelcontextprotocol/server";

declare const __SIDETEAM_VERSION__: string;

export function createServer(): McpServer {
  return new McpServer(
    { name: "sideteam", version: __SIDETEAM_VERSION__ },
    { capabilities: { tools: {} } },
  );
}
