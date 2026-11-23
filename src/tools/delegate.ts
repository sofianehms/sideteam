import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runDelegation } from "../delegate.js";

export function registerDelegate(server: McpServer) {
  server.registerTool(
    "delegate",
    {
      description: "Run a task in a separate Git worktree and verify the committed changes.",
      inputSchema: z.object({
        prompt: z.string().min(1),
        engine: z.string().optional(),
        files: z.array(z.string()).optional(),
        check: z.string().optional(),
        timeoutMinutes: z.number().positive().max(240).optional(),
      }),
    },
    async (input, { mcpReq }) => {
      const progressToken = mcpReq._meta?.progressToken;
      try {
        const result = await runDelegation(input, {
          onProgress:
            progressToken === undefined
              ? undefined
              : (elapsedMs) => {
                  void mcpReq
                    .notify({
                      method: "notifications/progress",
                      params: { progressToken, progress: elapsedMs / 1000 },
                    })
                    .catch(() => {});
                },
        });
        return {
          content: [{ type: "text", text: result.text }],
          structuredContent: result.structured,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );
}
