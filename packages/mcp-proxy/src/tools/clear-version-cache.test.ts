import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerClearVersionCacheTool } from './clear-version-cache.ts';
import { META_INTERCEPT_REASON } from './intercepts.ts';
import { clearStorybookVersionCache } from '../utils/version-check.ts';
import type { ProxyToolCallResult } from '../types/index.ts';

vi.mock('../utils/version-check.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../utils/version-check.ts')>();
	return { ...actual, clearStorybookVersionCache: vi.fn() };
});

async function buildServer() {
	const server = new McpServer(
		{ name: 'test', version: '0.0.0', description: 'test' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	);
	registerClearVersionCacheTool(server);
	await server.receive({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 't', version: '0' },
		},
	} as never);
	return server;
}

async function callTool(server: McpServer<any>, args: Record<string, unknown>) {
	return (await server.receive({
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/call',
		params: { name: 'clear-storybook-version-cache', arguments: args },
	} as never)) as { result: ProxyToolCallResult };
}

function firstText(result: ProxyToolCallResult): string {
	const item = result.content?.[0];
	if (!item || item.type !== 'text') {
		throw new Error(`expected text content, got ${JSON.stringify(item)}`);
	}
	return item.text;
}

beforeEach(() => {
	vi.mocked(clearStorybookVersionCache).mockReset();
});

describe('clear-storybook-version-cache tool', () => {
	it('lists the tool with cwd as a required field', async () => {
		const server = await buildServer();
		const response = (await server.receive({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {},
		} as never)) as { result: { tools: Array<{ name: string; inputSchema: any }> } };
		const tool = response.result.tools.find((t) => t.name === 'clear-storybook-version-cache');
		expect(tool).toBeDefined();
		expect(tool!.inputSchema.required ?? []).toContain('cwd');
	});

	it('clears the cache for the requested cwd and returns a success message', async () => {
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(clearStorybookVersionCache).toHaveBeenCalledWith('/projects/foo');
		expect(response.result.isError).toBeFalsy();
		expect(firstText(response.result)).toContain('/projects/foo');
	});

	it.each([['relative/path'], [''], ['./foo'], ['../foo']])(
		'returns the invalid-cwd intercept when cwd is not absolute (%j)',
		async (cwd) => {
			const server = await buildServer();
			const response = await callTool(server, { cwd });
			expect(response.result.isError).toBe(true);
			expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'invalid-cwd' });
			expect(clearStorybookVersionCache).not.toHaveBeenCalled();
		},
	);
});
