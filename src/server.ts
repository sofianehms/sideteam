import { McpServer } from "@modelcontextprotocol/server";
import { registerDelegate } from "./tools/delegate.js";

declare const __SIDETEAM_VERSION__: string;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "sideteam", version: __SIDETEAM_VERSION__ },
    { capabilities: { tools: {} } },
  );
  registerDelegate(server);
  return server;
}
