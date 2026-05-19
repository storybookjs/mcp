/**
 * Stdio entry point for `@storybook/mcp-proxy`.
 *
 * Usage:
 *   node bin.ts [--registryDir <path>]
 *
 * As an MCP server entry in an ADE config:
 *   {
 *     "storybook": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@storybook/mcp-proxy"]
 *     }
 *   }
 */
import { parseArgs } from 'node:util';
import { StdioTransport } from '@tmcp/transport-stdio';
import { createMcpProxyServer } from './src/index.ts';
import { DEFAULT_REGISTRY_DIR } from './src/registry.ts';

const { values } = parseArgs({
	options: {
		registryDir: { type: 'string', default: DEFAULT_REGISTRY_DIR },
	},
});

const server = await createMcpProxyServer({ registryDir: values.registryDir });
const transport = new StdioTransport(server);
transport.listen();
