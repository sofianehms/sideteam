import { McpServer } from "@modelcontextprotocol/server";
import { registerApply } from "./tools/apply.js";
import { registerDelegate } from "./tools/delegate.js";
import { registerDiscard } from "./tools/discard.js";
import { registerEngines } from "./tools/engines.js";
import { registerStats } from "./tools/stats.js";

declare const __SIDETEAM_VERSION__: string;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "sideteam", version: __SIDETEAM_VERSION__ },
    { capabilities: { tools: {} } },
  );
  registerDelegate(server);
  registerApply(server);
  registerDiscard(server);
  registerEngines(server);
  registerStats(server);
  return server;
}
