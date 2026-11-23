import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { applyDelegation } from "../apply.js";

export function registerApply(server: McpServer) {
  server.registerTool(
    "apply",
    {
      description: "Merge a delegation by ID.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => {
      try {
        return { content: [{ type: "text", text: await applyDelegation(id) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
