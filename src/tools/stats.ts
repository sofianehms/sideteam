import { realpath } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { git } from "../git.js";
import { readEvents } from "../journal.js";
import { dataDir } from "../paths.js";
import { renderSavings } from "../savings.js";
import { computeStats, renderStats } from "../stats.js";

export function registerStats(server: McpServer) {
  server.registerTool(
    "stats",
    {
      description:
        "Show delegation statistics and estimated token savings for the last 30 days by default.",
      inputSchema: z.object({
        sinceDays: z.number().positive().optional(),
        repo: z.enum(["current", "all"]).optional(),
      }),
    },
    async ({ sinceDays = 30, repo = "current" }) => {
      try {
        const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
        const root = await git(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true });
        if (root.code !== 0 && repo === "current") throw new Error("not inside a git repository");
        const repoRoot = root.code === 0 ? await realpath(root.stdout.replace(/\r?\n$/, "")) : cwd;
        const { config } = loadConfig({ repoRoot });
        const { events, malformed } = await readEvents(dataDir(config));
        const window = {
          sinceDays,
          repo: repo === "current" ? repoRoot : null,
          now: Date.now(),
        };
        const rows = computeStats(events, window);
        const savings = await renderSavings(events, window, config.savings);
        return {
          content: [{ type: "text", text: `${renderStats(rows, malformed)}\n\n${savings}` }],
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
