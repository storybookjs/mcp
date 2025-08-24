import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";

export function registerAdditionTool(server: McpServer) {
  server.registerTool(
    "add",
    {
      title: "Addition Tool",
      description: "Add two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );
}
