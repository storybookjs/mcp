import type { Connect } from "vite";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import pkgJson from "../package.json" with { type: "json" };
import { registerAdditionTool } from "./tools/addition";
import { registerUIBuildingTool } from "./tools/getUIBuildingInstructions";

function createMcpServer() {
  // New initialization request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      // Store the transport by session ID
      transports[sessionId] = transport;
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      delete transports[transport.sessionId];
    }
  };

  const server = new McpServer({
    name: pkgJson.name,
    version: pkgJson.version,
  });
  registerAdditionTool(server);
  registerUIBuildingTool(server);

  server.connect(transport);
  return transport;
}

// Map to store transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {};

async function getJson(req: Connect.IncomingMessage) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// Handle POST requests for client-to-server communication
const handlePostRequest: Connect.SimpleHandleFunction = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  const body = await getJson(req);

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(body)) {
    transport = await createMcpServer();
  } else {
    // Invalid request
    res.statusCode = 400;
    res.end(
      JSON.stringify(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Handle the request
  await transport.handleRequest(req, res, body);
};

// Reusable handler for GET and DELETE requests
const handleSessionRequest: Connect.SimpleHandleFunction = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports[sessionId]) {
    res.statusCode = 400;
    res.end("Invalid or missing session ID");
    return;
  }

  const transport = transports[sessionId];
  return await transport.handleRequest(req, res);
};

export const mcpServerHandler: Connect.NextHandleFunction = async (
  req,
  res,
  next,
) => {
  switch (req.method) {
    case "POST":
      return await handlePostRequest(req, res);
    case "GET":
    case "DELETE":
      return await handleSessionRequest(req, res);
    default:
      next();
  }
};
