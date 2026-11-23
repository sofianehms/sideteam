import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { discardDelegation } from "../apply.js";

export function registerDiscard(server: McpServer) {
  server.registerTool(
    "discard",
    {
      description: "Remove a delegation by ID.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => {
      try {
        return { content: [{ type: "text", text: await discardDelegation(id) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
