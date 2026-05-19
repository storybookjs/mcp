import { describe, expect, it, vi } from 'vitest';
import { StdioTransport } from '@tmcp/transport-stdio';
import * as proxy from './index.ts';

describe('createStorybookMcpProxyServer', () => {
	it('creates a placeholder server with no tools', async () => {
		const server = proxy.createStorybookMcpProxyServer();

		const initializeResponse = await server.receive({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {
					name: 'test-client',
					version: '1.0.0',
				},
			},
		});

		expect(initializeResponse).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				serverInfo: {
					name: '@storybook/mcp-proxy',
				},
			},
		});

		const toolsResponse = await server.receive({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {},
		});

		expect(toolsResponse).toMatchObject({
			jsonrpc: '2.0',
			id: 2,
			result: {
				tools: [],
			},
		});
	});
});

describe('listen', () => {
	it('starts the stdio transport', () => {
		const listenSpy = vi.spyOn(StdioTransport.prototype, 'listen').mockImplementation(() => {});

		proxy.listen();

		expect(listenSpy).toHaveBeenCalledOnce();
		listenSpy.mockRestore();
	});

	it('runs when the bin entry is imported', async () => {
		const listenSpy = vi.spyOn(proxy, 'listen').mockImplementation(() => {});

		await import('./bin.ts');

		expect(listenSpy).toHaveBeenCalled();
		listenSpy.mockRestore();
	});
});
