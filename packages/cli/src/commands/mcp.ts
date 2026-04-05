import { Command } from "commander";
import { startMcpServer } from "@kb/mcp-server";

export function makeMcpCommand(): Command {
  return new Command("mcp")
    .description("Start MCP server (stdio)")
    .action(async () => {
      await startMcpServer();
    });
}
