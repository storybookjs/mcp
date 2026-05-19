# Storybook MCP Proxy

Stable MCP server package for Storybook agent integrations.

This package is intentionally minimal in the plugin-package milestone. It starts a valid stdio MCP server and returns an empty tool list, so Claude and Codex plugin wiring can be installed and smoke-tested before the real proxy implementation exists.

Milestone 2 of storybookjs/storybook#34826 will replace this placeholder with the proxy that discovers running Storybook instances and forwards the seven Storybook MCP tools to the matching local Storybook `/mcp` endpoint.

## Usage

After the package is released to npm, plugin MCP configs should run:

```sh
npx -y @storybook/mcp-proxy@latest
```

During PR review, use the preview package URL published by the `Publish preview` workflow. That workflow runs `pnpm pkg-pr-new publish --pnpm --no-template './packages/*'`, so this package is published to pkg.pr.new for each PR commit without publishing to npm.

```sh
npx -y --package https://pkg.pr.new/storybookjs/mcp/@storybook/mcp-proxy@<commit> storybook-mcp-proxy
```

Use the exact URL from the pkg.pr.new PR comment or check output. The preview package is not published to npm.

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
