import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

declare const __SIDETEAM_VERSION__: string;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "sideteam", version: __SIDETEAM_VERSION__ },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  return server;
}
