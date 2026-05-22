import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { registerProxiedTools } from './index.ts';
import { META_INTERCEPT_REASON } from './intercepts.ts';
import { readRegistry } from '../utils/registry.ts';
import { proxyToolCall } from '../utils/proxy-client.ts';
import { enumerateWorkspacePackages, findWorkspaceRoot } from '../utils/workspace.ts';
import type { ProxyToolCallResult, StorybookInstanceRecordV1 } from '../types/index.ts';

vi.mock('../utils/registry.ts', () => ({
	readRegistry: vi.fn(),
}));

vi.mock('../utils/proxy-client.ts', () => ({
	proxyToolCall: vi.fn(),
}));

vi.mock('../utils/workspace.ts', () => ({
	findWorkspaceRoot: vi.fn(),
	enumerateWorkspacePackages: vi.fn(),
}));

const REGISTRY_DIR = '/tmp/test-registry';

const record: StorybookInstanceRecordV1 = {
	schemaVersion: 1,
	instanceId: 'inst-1',
	pid: 1,
	cwd: '/projects/foo',
	url: 'http://localhost:6006',
	port: 6006,
	mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
};

beforeEach(() => {
	vi.mocked(readRegistry).mockReset();
	vi.mocked(proxyToolCall).mockReset();
	vi.mocked(findWorkspaceRoot).mockReset();
	vi.mocked(enumerateWorkspacePackages).mockReset();
	vi.mocked(readRegistry).mockResolvedValue([record]);
	vi.mocked(proxyToolCall).mockResolvedValue({
		content: [{ type: 'text', text: 'upstream result' }],
	});
	vi.mocked(findWorkspaceRoot).mockResolvedValue(undefined);
	vi.mocked(enumerateWorkspacePackages).mockResolvedValue([]);
});

async function buildServer() {
	const server = new McpServer(
		{ name: 'test', version: '0.0.0', description: 'test' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	);
	registerProxiedTools(server, REGISTRY_DIR);
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

async function listTools(server: McpServer<any>) {
	return (await server.receive({
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
		params: {},
	} as never)) as { result: { tools: Array<{ name: string; inputSchema: any }> } };
}

async function callTool(server: McpServer<any>, args: Record<string, unknown>) {
	return (await server.receive({
		jsonrpc: '2.0',
		id: 3,
		method: 'tools/call',
		params: { name: 'list-all-documentation', arguments: args },
	} as never)) as { result: ProxyToolCallResult };
}

function firstText(result: ProxyToolCallResult): string {
	const item = result.content?.[0];
	if (!item || item.type !== 'text') {
		throw new Error(`expected text content, got ${JSON.stringify(item)}`);
	}
	return item.text;
}

describe('registerProxyTool / list-all-documentation', () => {
	it('exposes all 7 proxied tools, each with cwd as a required field', async () => {
		const server = await buildServer();
		const response = await listTools(server);
		const names = response.result.tools.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'get-changed-stories',
				'get-documentation',
				'get-documentation-for-story',
				'get-storybook-story-instructions',
				'list-all-documentation',
				'preview-stories',
				'run-story-tests',
			].sort(),
		);
		for (const tool of response.result.tools) {
			const props = Object.keys(tool.inputSchema.properties ?? {});
			expect(props, `tool ${tool.name} should expose cwd`).toContain('cwd');
			const required = tool.inputSchema.required ?? [];
			expect(required, `tool ${tool.name} should require cwd`).toContain('cwd');
		}
	});

	it('returns the no-instance intercept (empty) when the registry is empty', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(firstText(response.result)).toContain('No Storybook is running');
	});

	it('returns the no-instance intercept with candidate cwds when no record matches', async () => {
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/bar' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(firstText(response.result)).toContain('Running Storybooks');
		expect(firstText(response.result)).toContain('/projects/foo');
	});

	it('proxies tool args downstream and forwards the upstream result on exact match', async () => {
		vi.mocked(proxyToolCall).mockResolvedValue({
			content: [{ type: 'text', text: 'COMPONENTS' }],
		});
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo', withStoryIds: true });
		expect(proxyToolCall).toHaveBeenCalledWith(record, {
			name: 'list-all-documentation',
			arguments: { withStoryIds: true },
		});
		expect(firstText(response.result)).toBe('COMPONENTS');
	});

	it('dispatches mcp.status=starting to the mcp-starting intercept', async () => {
		vi.mocked(readRegistry).mockResolvedValue([{ ...record, mcp: { status: 'starting' } }]);
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'mcp-starting' });
	});

	it('dispatches mcp.status=not-installed to the addon-missing intercept', async () => {
		vi.mocked(readRegistry).mockResolvedValue([{ ...record, mcp: { status: 'not-installed' } }]);
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'addon-missing' });
	});

	it('dispatches mcp.status=error to the mcp-error intercept', async () => {
		vi.mocked(readRegistry).mockResolvedValue([
			{ ...record, mcp: { status: 'error', endpoint: 'http://localhost:6006/mcp' } },
		]);
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'mcp-error' });
	});

	it.each([['relative/path'], [''], ['./foo'], ['../foo']])(
		'returns the invalid-cwd intercept when cwd is not absolute (%j)',
		async (cwd) => {
			const server = await buildServer();
			const response = await callTool(server, { cwd });
			expect(response.result.isError).toBe(true);
			expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'invalid-cwd' });
			expect(firstText(response.result)).toContain('absolute path');
		},
	);

	it('enriches no-instance with workspace packages when the cwd is in a monorepo', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		vi.mocked(findWorkspaceRoot).mockResolvedValue({
			root: '/projects/monorepo',
			patterns: ['packages/*'],
			source: 'pnpm-workspace.yaml',
		});
		vi.mocked(enumerateWorkspacePackages).mockResolvedValue([
			{
				packagePath: '/projects/monorepo/packages/ui',
				name: '@app/ui',
				hasStorybook: true,
				hasAddonMcp: false,
			},
			{
				packagePath: '/projects/monorepo/packages/api',
				name: '@app/api',
				hasStorybook: false,
				hasAddonMcp: false,
			},
		]);

		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/monorepo' });

		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		const text = firstText(response.result);
		expect(text).toContain('@app/ui');
		expect(text).toContain('@app/api');
		expect(text).toContain('Workspace packages in this monorepo');
		expect(vi.mocked(findWorkspaceRoot)).toHaveBeenCalledWith('/projects/monorepo');
	});

	it('falls back gracefully when workspace discovery throws', async () => {
		vi.mocked(readRegistry).mockResolvedValue([]);
		vi.mocked(findWorkspaceRoot).mockRejectedValue(new Error('boom'));

		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/anywhere' });

		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(firstText(response.result)).toContain('No Storybook is running');
	});

	it('surfaces a friendly error when proxyToolCall throws', async () => {
		vi.mocked(proxyToolCall).mockRejectedValue(new Error('connection refused'));
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(firstText(response.result)).toContain('Failed to reach Storybook MCP');
		expect(firstText(response.result)).toContain('connection refused');
	});
});
