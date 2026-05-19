import { StdioTransport } from '@tmcp/transport-stdio';
import { McpServer } from 'tmcp';

import pkg from '../package.json' with { type: 'json' };

const instructions = [
	'This is a placeholder Storybook MCP proxy.',
	'It intentionally exposes no Storybook tools yet.',
	'The real proxy implementation will be added in the @storybook/mcp-proxy milestone.',
].join('\n');

export function createStorybookMcpProxyServer() {
	return new McpServer(
		{
			name: pkg.name,
			version: pkg.version,
			description: pkg.description,
		},
		{
			adapter: undefined,
			instructions,
			capabilities: {
				tools: { listChanged: true },
			},
		},
	);
}

export function listen() {
	const server = createStorybookMcpProxyServer();
	const transport = new StdioTransport(server);

	transport.listen();
}
