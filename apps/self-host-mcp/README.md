# Self-hosting example (`@storybook/mcp`)

This app shows the smallest practical way to run `@storybook/mcp` as an HTTP endpoint in Node.js or Netlify Functions.

It is available to experiment with at https://storybook-mcp-self-host-example.netlify.app/mcp

## Run

From the repository root:

```bash
pnpm install
cd apps/self-host-mcp
pnpm start
```

MCP endpoint: `http://localhost:13316/mcp`

## Options

```bash
cd apps/self-host-mcp
pnpm start -- --port 13316 --manifestsPath ./manifests
```

- `--port`: HTTP port to serve
- `--manifestsPath`: local directory or remote base URL containing `components.json` and optionally `docs.json`

## Use your own components

To try this server with your own component library, first build your Storybook so it generates manifests, then copy the content of the `manifests` directory from the build-output (usually `./storybook-static/manifests`) into this example's `manifests/` directory.

In practice, you want `components.json` (and `docs.json` if available) in `apps/self-host-mcp/manifests/` before running `pnpm start`.

## Run on Netlify Functions

This example also includes a Netlify function at `netlify/functions/mcp.ts` and routing in `netlify.toml`.

1. Build your Storybook and copy generated manifests into `apps/self-host-mcp/manifests/` (or set `MANIFESTS_PATH` to a remote URL).
2. Deploy `apps/self-host-mcp` as a Netlify project.
3. Your MCP endpoint is available at `/mcp` (rewritten to `/.netlify/functions/mcp`).

## What this demonstrates

- Instantiate a handler with `createStorybookMcpHandler`
- Route only `/mcp` requests to MCP transport
- Provide a custom `manifestProvider` for local or remote manifest sources
- Use the same handler implementation for both Node and Netlify Functions

For full guidance and Netlify Functions adaptation notes, see [packages/mcp/docs/self-hosting.md](../../packages/mcp/docs/self-hosting.md).
