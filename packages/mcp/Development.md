To run the MCP locally with fixture data:

```bash
pnpm dev
```

To test that the server is running:

```bash
curl -X POST \
  http://localhost:13316/mcp      \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

To test a particular tool call:

```bash
curl -X POST http://localhost:13316/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list-all-components",
      "arguments": {}
    }
  }'
```