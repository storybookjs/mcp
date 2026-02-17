# Node self-hosting example (`@storybook/mcp`)

This app shows the smallest practical way to run `@storybook/mcp` as an HTTP endpoint in Node.js.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter @storybook/mcp-self-host-node dev
```

MCP endpoint: `http://localhost:13316/mcp`

## Options

```bash
pnpm --filter @storybook/mcp-self-host-node dev -- --port 13316 --manifestsDir ./manifests --format markdown
```

- `--port`: HTTP port to serve
- `--manifestsDir`: local directory or remote base URL containing `components.json` and optionally `docs.json`
- `--format`: `markdown` (default) or `xml`

## What this demonstrates

- Instantiate a handler with `createStorybookMcpHandler`
- Route only `/mcp` requests to MCP transport
- Provide a custom `manifestProvider` for local or remote manifest sources

For full guidance and Netlify Functions adaptation notes, see [packages/mcp/docs/self-hosting.md](../../packages/mcp/docs/self-hosting.md).
