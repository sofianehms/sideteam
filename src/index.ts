import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

await createServer()
  .connect(new StdioServerTransport())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
