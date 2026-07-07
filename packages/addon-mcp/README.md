# Storybook MCP Addon

Storybook addon for MCP-powered UI development workflows.

<div align="center">
	<img src="./addon-mcp-claude-code-showcase.gif" alt="Storybook MCP Addon Demo" />
</div>

See [documentation](https://storybook.js.org/docs/next/ai/mcp/overview/?ref=readme) for installation instructions, usage examples, APIs, and more.

## Configuration

By default, the addon exposes its MCP server at `/mcp`. You can configure a
different literal endpoint path in `.storybook/main.ts`:

```ts
export default {
	addons: [
		{
			name: '@storybook/addon-mcp',
			options: {
				endpoint: '/custom-mcp',
			},
		},
	],
};
```

The endpoint must be a URL pathname such as `/custom-mcp` or `/tools/mcp`.

## Debugging tool calls

Similar to `STORYBOOK_TELEMETRY_DEBUG` for telemetry, two environment
variables let you inspect every MCP tool call (inputs, outputs, errors,
timing, and session/client info):

- `STORYBOOK_MCP_DEBUG` — when set to a truthy value, each record is written
  to stderr as an NDJSON line prefixed with `[storybook-mcp-debug]`.
- `STORYBOOK_MCP_DEBUG_URL` — when set, each record is POSTed as JSON to this
  URL. Point it at the `mcp-logger` dashboard from
  [`@hipster/sb-utils`](https://github.com/yannbf/sb-utils) to explore calls
  in real time:

```sh
# Terminal 1: start the collector + dashboard
npx @hipster/sb-utils mcp-logger

# Terminal 2: start Storybook with MCP debug logging pointed at it
STORYBOOK_MCP_DEBUG_URL=http://localhost:6008/mcp-log yarn storybook
```

Records cover session initialization (`session-start`) and tool execution
(`tool-call-start` / `tool-call-end` with duration, result, and error
details). Logging is fire-and-forget and never affects tool behavior.

Learn more about Storybook at [storybook.js.org](https://storybook.js.org/?ref=readme).
