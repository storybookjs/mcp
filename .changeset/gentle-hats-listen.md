---
'@storybook/mcp': minor
'@storybook/addon-mcp': minor
---

Add MCP tool call debug logging, gated by two new environment variables mirroring Storybook's telemetry debugging: `STORYBOOK_MCP_DEBUG` writes every tool call record (inputs, outputs, errors, timing, session/client info) to stderr as NDJSON, and `STORYBOOK_MCP_DEBUG_URL` POSTs the same records to a collector such as the `mcp-logger` dashboard from `@hipster/sb-utils`. `@storybook/mcp` exports the `instrumentMcpServerForDebug` / `getMcpDebugConfig` helpers, and both the standalone server (http + stdio) and the addon MCP server are instrumented when the variables are set.
