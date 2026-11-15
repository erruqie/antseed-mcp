// stdout belongs to the MCP protocol: diagnostics go to stderr only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "./client";
import { loadConfig } from "./config";
import { createServer } from "./server";

try {
  const config = await loadConfig();
  const server = createServer({ client: createClient(config), config });
  await server.connect(new StdioServerTransport());
  console.error(`antseed-mcp: ${config.url}, writes ${config.allowWrites ? "enabled" : "disabled"}`);
} catch (error) {
  console.error(`antseed-mcp: ${(error as Error)?.message ?? error}`);
  process.exit(1);
}
