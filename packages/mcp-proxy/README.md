# Storybook MCP Proxy

Stable MCP server package for Storybook agent integrations.

This package is intentionally minimal in the plugin-package milestone. It starts a valid stdio MCP server and returns an empty tool list, so Claude and Codex plugin wiring can be installed and smoke-tested before the real proxy implementation exists.

Milestone 2 of storybookjs/storybook#34826 will replace this placeholder with the proxy that discovers running Storybook instances and forwards the seven Storybook MCP tools to the matching local Storybook `/mcp` endpoint.

## Usage

After the package is released to npm, plugin MCP configs should run:

```sh
npx -y @storybook/mcp-proxy@latest
```

During development, the Claude and Codex plugins point at the latest pkg.pr.new preview for PR #227:

```sh
npx -y --package https://pkg.pr.new/storybookjs/mcp/@storybook/mcp-proxy@227
```

The `@227` ref tracks the newest preview build published by the `Publish preview` workflow for that pull request.

## Local Testing

Build the package:

```sh
pnpm --filter @storybook/mcp-proxy build
```

Run the built binary:

```sh
node packages/mcp-proxy/dist/bin.js
```

Smoke-test the MCP handshake:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node packages/mcp-proxy/dist/bin.js
```

Expected result: the server responds to `initialize` and returns `"tools":[]` for `tools/list`.
