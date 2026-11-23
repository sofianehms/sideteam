import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { inject } from "vitest";

export async function connectMcpClient(cwd: string, env?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "sideteam-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [inject("bundle")],
    cwd,
    env,
    stderr: "inherit",
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close();
    throw error;
  }
}
