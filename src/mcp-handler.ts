import type { Connect } from "vite";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

function setupMcpServer(transport: StreamableHTTPServerTransport) {
  const server = new McpServer({
    name: "example-server",
    version: "1.0.0",
  });

  // ... set up server resources, tools, and prompts ...

  server.connect(transport);
  return server;
}

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

async function getJson(req: Connect.IncomingMessage) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// Handle POST requests for client-to-server communication
const handlePostRequest: Connect.SimpleHandleFunction = async (req, res) => {
  // Check for existing session ID
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  const body = await getJson(req);

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        transports[sessionId] = transport;
      },
      enableDnsRebindingProtection: true,
      allowedHosts: ["127.0.0.1"],
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };
    const server = new McpServer({
      name: "example-server",
      version: "1.0.0",
    });

    await setupMcpServer(transport);
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
  await transport.handleRequest(req, res);
};

export const mcpServerHandler: Connect.NextHandleFunction = async (
  req,
  res,
  next,
) => {
  console.log("request to /mcp");
  switch (req.method) {
    case "POST":
      await handlePostRequest(req, res);
      break;
    case "GET":
    case "DELETE":
      await handleSessionRequest(req, res);
      break;
    default:
      next();
  }
};
