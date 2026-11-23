import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

await createServer()
  .connect(new StdioServerTransport())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
