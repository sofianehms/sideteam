import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { inject } from "vitest";

export async function connectMcpClient(cwd: string): Promise<Client> {
  const client = new Client({ name: "sideteam-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [inject("bundle")],
    cwd,
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
