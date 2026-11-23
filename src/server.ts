import { McpServer } from "@modelcontextprotocol/server";
import { registerApply } from "./tools/apply.js";
import { registerDelegate } from "./tools/delegate.js";
import { registerDiscard } from "./tools/discard.js";

declare const __SIDETEAM_VERSION__: string;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "sideteam", version: __SIDETEAM_VERSION__ },
    { capabilities: { tools: {} } },
  );
  registerDelegate(server);
  registerApply(server);
  registerDiscard(server);
  return server;
}
