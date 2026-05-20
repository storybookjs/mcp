import { StdioTransport } from '@tmcp/transport-stdio';
import { describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { createStorybookMcpProxyServer, listen } from './index.ts';

const CLIENT_INFO = { name: 'test-client', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

function initializeRequest(id = 1) {
	return {
		jsonrpc: '2.0' as const,
		id,
		method: 'initialize',
		params: {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: CLIENT_INFO,
		},
	};
}

function toolsListRequest(id = 2) {
	return {
		jsonrpc: '2.0' as const,
		id,
		method: 'tools/list',
		params: {},
	};
}

describe('createStorybookMcpProxyServer', () => {
	it('responds to initialize with server metadata and placeholder instructions', async () => {
		const server = createStorybookMcpProxyServer();

		const response = await server.receive(initializeRequest());

		expect(response).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				serverInfo: {
					name: pkg.name,
					version: pkg.version,
				},
				capabilities: {
					tools: { listChanged: true },
				},
				instructions: expect.stringContaining('placeholder Storybook MCP proxy'),
			},
		});
	});

	it('responds to tools/list with an empty tool list after initialize', async () => {
		const server = createStorybookMcpProxyServer();

		await server.receive(initializeRequest());

		const response = await server.receive(toolsListRequest());

		expect(response).toMatchObject({
			jsonrpc: '2.0',
			id: 2,
			result: {
				tools: [],
			},
		});
	});
});

describe('listen', () => {
	it('starts stdio transport for the proxy server', () => {
		const listenSpy = vi
			.spyOn(StdioTransport.prototype, 'listen')
			.mockImplementation(() => {});

		listen();

		expect(listenSpy).toHaveBeenCalledOnce();
		listenSpy.mockRestore();
	});
});

describe('bin.ts', () => {
	it('invokes listen when loaded', async () => {
		const listenSpy = vi
			.spyOn(StdioTransport.prototype, 'listen')
			.mockImplementation(() => {});

		await import('./bin.ts');

		expect(listenSpy).toHaveBeenCalledOnce();
		listenSpy.mockRestore();
		vi.resetModules();
	});
});
