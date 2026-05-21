# `@storybook/mcp-proxy`

A stable, stdio-fronted MCP server that forwards tool calls to the local Storybook MCP server exposed by [`@storybook/addon-mcp`](../addon-mcp).

## Why a proxy?

Agent clients (Claude, Codex, etc.) configure an MCP server once and expect it to keep working as long-running Storybook processes start and stop. The addon's HTTP endpoint moves with each `storybook dev` (cwd, port, lifecycle), so wiring an agent directly to it is brittle.

The proxy is the stable address: it reads the on-disk **registry** of running Storybook instances and routes each tool call to the right one based on the project's `cwd`.

```
agent ──stdio──▶ @storybook/mcp-proxy ──http──▶ @storybook/addon-mcp (per Storybook)
                       ▲
                       │  reads
                ~/.storybook/instances/*.json   (one file per running Storybook)
```

## Install / run

Run via `npx`; no install needed:

```sh
npx -y @storybook/mcp-proxy
```

Until the package is published to npm, use the pkg.pr.new preview from `main`:

```sh
npx -y https://pkg.pr.new/storybookjs/mcp/@storybook/mcp-proxy@main
```

### MCP client configuration

```json
{
  "mcpServers": {
    "storybook": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@storybook/mcp-proxy"]
    }
  }
}
```

## How routing works

Every proxied tool requires a `cwd` argument: the **absolute** path of the Storybook project the call targets. It must exactly match the cwd from which `storybook dev` was started — there is no prefix matching or fallback.

1. The proxy reads every JSON file under the registry directory and drops records whose PID is no longer alive.
2. It picks the record whose `cwd` matches the request after `path.resolve` normalisation.
3. Based on that record's `mcp.status`, it either forwards the call over HTTP or returns a structured intercept message describing what to do.

### Intercept reasons

The proxy never silently fails. When it can't forward a call, it returns an `isError: true` result whose `_meta` carries one of:

| Reason | Meaning |
| --- | --- |
| `invalid-cwd` | The supplied `cwd` was not an absolute path. |
| `no-instance` | No Storybook is running at the requested `cwd`. Lists other running cwds as candidates when present. |
| `multiple-matches` | Two or more records share the same `cwd` (degenerate registry state). |
| `mcp-starting` | A Storybook is registered there but its MCP endpoint hasn't come up yet. |
| `addon-missing` | The matching Storybook does not have `@storybook/addon-mcp` installed. |
| `mcp-error` | The addon registered an error status for its MCP endpoint. |

## Proxied tools

The proxy registers the seven Storybook tools exposed by `@storybook/addon-mcp`, each with `cwd` added as a required input. See [`src/instructions.md`](./src/instructions.md) for the agent-facing routing guide.

- `list-all-documentation`
- `get-documentation`
- `get-documentation-for-story`
- `preview-stories`
- `get-changed-stories`
- `get-storybook-story-instructions`
- `run-story-tests`

## Programmatic use

```ts
import { createMcpProxyServer } from '@storybook/mcp-proxy';

const server = await createMcpProxyServer({
  registryDir: '/custom/registry/dir', // optional
});
```

`createMcpProxyServer` returns a configured `tmcp` `McpServer`; wire it to any transport you like.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm build` | Bundle `bin.ts` and `src/index.ts` with `tsdown`. |
| `pnpm test` | Run vitest from the repo root, scoped to this package. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm inspect` | Launch the MCP Inspector against the proxy. |
