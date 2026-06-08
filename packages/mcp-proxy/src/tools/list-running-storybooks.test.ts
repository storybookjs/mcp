import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerListRunningStorybooksTool } from './list-running-storybooks.ts';
import { readRegistry } from '../utils/registry.ts';
import type { ProxyToolCallResult } from '../types/index.ts';
import type { StorybookInstanceRecordV1 } from '../types/index.ts';

vi.mock('../utils/registry.ts', () => ({
	readRegistry: vi.fn(),
}));

const REGISTRY_DIR = '/tmp/test-registry';

const record: StorybookInstanceRecordV1 = {
	schemaVersion: 1,
	instanceId: 'inst-1',
	pid: 1,
	cwd: '/projects/foo',
	url: 'http://localhost:6006',
	port: 6006,
	storybookVersion: '10.4.0',
	mcp: { status: 'ready', endpoint: '/mcp' },
};

async function buildServer() {
	const server = new McpServer(
		{ name: 'test', version: '0.0.0', description: 'test' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	);
	registerListRunningStorybooksTool(server, REGISTRY_DIR);
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

async function callTool(server: McpServer<any>, args: Record<string, unknown> = {}) {
	return (await server.receive({
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/call',
		params: { name: 'list-running-storybooks', arguments: args },
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
	vi.mocked(readRegistry).mockReset();
});

describe('list-running-storybooks tool', () => {
	it('lists the tool with no required arguments', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		const server = await buildServer();
		const response = (await server.receive({
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/list',
			params: {},
		} as never)) as { result: { tools: Array<{ name: string; inputSchema: any }> } };
		const tool = response.result.tools.find((t) => t.name === 'list-running-storybooks');
		expect(tool).toBeDefined();
		expect(tool!.inputSchema.required ?? []).toEqual([]);
	});

	it('reads the registry from the configured directory', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		const server = await buildServer();
		await callTool(server);
		expect(readRegistry).toHaveBeenCalledWith(REGISTRY_DIR);
	});

	it('returns a message when no Storybooks are running', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		const server = await buildServer();
		const response = await callTool(server);
		expect(response.result.isError).toBeFalsy();
		expect(firstText(response.result)).toMatchInlineSnapshot(`"No Storybook dev servers are currently running. Start one with \`storybook dev\` from your project directory."`);
	});

	it('lists each running Storybook with cwd, url, port, and version', async () => {
		vi.mocked(readRegistry).mockResolvedValue([
			record,
			{ ...record, instanceId: 'inst-2', cwd: '/projects/bar', port: 6007, url: 'http://localhost:6007', storybookVersion: undefined },
		]);
		const server = await buildServer();
		const text = firstText((await callTool(server)).result);
		expect(text).toMatchInlineSnapshot(`
			"Running Storybooks (2):
			- \`/projects/foo\`
			  - url: http://localhost:6006
			  - port: 6006
			  - storybook version: 10.4.0
			  - mcp status: ready
			- \`/projects/bar\`
			  - url: http://localhost:6007
			  - port: 6007
			  - storybook version: unknown
			  - mcp status: ready"
		`)
	});
});
