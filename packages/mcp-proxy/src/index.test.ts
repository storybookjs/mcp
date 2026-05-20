import { describe, expect, it } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { createMcpProxyServer } from './index.ts';

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

async function makeServer() {
	return createMcpProxyServer({
		deps: {
			readRegistry: async () => [],
		},
	});
}

describe('createMcpProxyServer', () => {
	it('responds to initialize with server metadata and instructions', async () => {
		const server = await makeServer();

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
				instructions: expect.any(String),
			},
		});
	});

	it('lists the proxied Storybook tools after initialize', async () => {
		const server = await makeServer();

		await server.receive(initializeRequest());

		const response = await server.receive(toolsListRequest());

		expect(response).toMatchObject({ jsonrpc: '2.0', id: 2 });
		const tools = (response as { result: { tools: Array<{ name: string }> } }).result.tools;
		expect(tools.map((t) => t.name)).toEqual(
			expect.arrayContaining([
				'list-all-documentation',
				'get-documentation',
				'get-documentation-for-story',
				'preview-stories',
				'get-changed-stories',
				'get-storybook-story-instructions',
				'run-story-tests',
			]),
		);
	});
});
