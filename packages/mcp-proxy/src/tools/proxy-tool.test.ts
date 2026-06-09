import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { registerProxiedTools } from './index.ts';
import { META_INTERCEPT_REASON } from './intercepts.ts';
import { readRegistry } from '../utils/registry.ts';
import { proxyToolCall } from '../utils/proxy-client.ts';
import { checkStorybookVersion } from '../utils/version-check.ts';
import type { ProxyToolCallResult, StorybookInstanceRecordV1 } from '../types/index.ts';

vi.mock('../utils/registry.ts', () => ({
	readRegistry: vi.fn(),
}));

vi.mock('../utils/proxy-client.ts', () => ({
	proxyToolCall: vi.fn(),
}));

vi.mock('../utils/version-check.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../utils/version-check.ts')>();
	return { ...actual, checkStorybookVersion: vi.fn() };
});

const REGISTRY_DIR = '/tmp/test-registry';
const serverClientInfo = new WeakMap<McpServer<any>, { name: string; version: string }>();

const record: StorybookInstanceRecordV1 = {
	schemaVersion: 1,
	instanceId: 'inst-1',
	pid: 1,
	cwd: '/projects/foo',
	url: 'http://localhost:6006',
	port: 6006,
	mcp: { status: 'ready', endpoint: '/mcp' },
};

beforeEach(() => {
	vi.mocked(readRegistry).mockReset();
	vi.mocked(proxyToolCall).mockReset();
	vi.mocked(checkStorybookVersion).mockReset();
	vi.mocked(readRegistry).mockResolvedValue([record]);
	vi.mocked(proxyToolCall).mockResolvedValue({
		content: [{ type: 'text', text: 'upstream result' }],
	});
	vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'ok' });
});

async function buildServer(clientInfo = { name: 't', version: '0' }) {
	const server = new McpServer(
		{ name: 'test', version: '0.0.0', description: 'test' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	);
	registerProxiedTools(server, REGISTRY_DIR);
	serverClientInfo.set(server, clientInfo);
	await server.receive({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo,
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
	const clientInfo = serverClientInfo.get(server);
	return (await server.receive(
		{
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'list-all-documentation', arguments: args },
		} as never,
		{
			sessionInfo: { clientInfo },
		} as never,
	)) as { result: ProxyToolCallResult };
}

function firstText(result: ProxyToolCallResult): string {
	const item = result.content?.[0];
	if (!item || item.type !== 'text') {
		throw new Error(`expected text content, got ${JSON.stringify(item)}`);
	}
	return item.text;
}

describe('registerProxyTool / list-all-documentation', () => {
	it('exposes all proxied tools plus the cache-clear control tool, each with cwd as a required field', async () => {
		const server = await buildServer();
		const response = await listTools(server);
		const names = response.result.tools.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'clear-storybook-version-cache',
				'display-review',
				'get-changed-stories',
				'get-documentation',
				'get-documentation-for-story',
				'get-stories-by-component',
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
		expect(firstText(response.result)).toContain('Storybook is not running');
		expect(firstText(response.result)).not.toContain('storybook-setup-claude-launch');
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
			{ ...record, mcp: { status: 'error', endpoint: '/mcp' } },
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

	it('returns the storybook-too-old intercept when the installed Storybook predates the min version', async () => {
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'too-old', version: '9.0.5' });
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'storybook-too-old' });
		expect(firstText(response.result)).toContain('9.0.5');
		expect(firstText(response.result)).toContain('storybook-upgrade');
	});

	it('prefers the runtime record version over the disk check: record too-old → too-old intercept even if disk says ok', async () => {
		vi.mocked(readRegistry).mockResolvedValue([{ ...record, storybookVersion: '9.1.20' }]);
		// Disk would say ok; the record's self-reported version must win.
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'ok' });
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'storybook-too-old' });
		expect(firstText(response.result)).toContain('9.1.20');
		expect(checkStorybookVersion).not.toHaveBeenCalled();
	});

	it('prefers the runtime record version over the disk check: record ok → proxies even if disk says too-old', async () => {
		vi.mocked(readRegistry).mockResolvedValue([{ ...record, storybookVersion: '10.5.0-alpha.4' }]);
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'too-old', version: '8.6.18' });
		vi.mocked(proxyToolCall).mockResolvedValue({ content: [{ type: 'text', text: 'COMPONENTS' }] });
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(firstText(response.result)).toBe('COMPONENTS');
		expect(checkStorybookVersion).not.toHaveBeenCalled();
	});

	it('falls back to the disk check only when the matched record has no storybookVersion', async () => {
		// base `record` omits storybookVersion → the disk check is consulted
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'too-old', version: '9.0.0' });
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'storybook-too-old' });
		expect(checkStorybookVersion).toHaveBeenCalledWith('/projects/foo');
	});

	it('returns the storybook-not-installed intercept when Storybook is unresolvable and nothing is running at the cwd', async () => {
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'not-installed' });
		vi.mocked(readRegistry).mockResolvedValue([]);
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'storybook-not-installed' });
		expect(firstText(response.result)).toContain('storybook-init');
	});

	it('still proxies to a running instance even when the version check reports not-installed (avoids monorepo false negatives)', async () => {
		vi.mocked(checkStorybookVersion).mockReturnValue({ status: 'not-installed' });
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

	it('proxies the call and prepends a multi-instance warning when 2+ ready instances share the cwd', async () => {
		const a: StorybookInstanceRecordV1 = {
			...record,
			instanceId: 'inst-a',
			pid: 200,
			port: 6006,
			url: 'http://localhost:6006',
			mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
		};
		const b: StorybookInstanceRecordV1 = {
			...record,
			instanceId: 'inst-b',
			pid: 100,
			port: 6007,
			url: 'http://localhost:6007',
			mcp: { status: 'ready', endpoint: 'http://localhost:6007/mcp' },
		};
		vi.mocked(readRegistry).mockResolvedValue([a, b]);
		vi.mocked(proxyToolCall).mockResolvedValue({
			content: [{ type: 'text', text: 'PRIMARY' }],
		});

		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });

		// Lowest pid (b) is chosen.
		expect(proxyToolCall).toHaveBeenCalledWith(b, expect.anything());

		const items = response.result.content ?? [];
		expect(items).toHaveLength(2);
		const warning = items[0];
		const primary = items[1];
		if (!warning || warning.type !== 'text') throw new Error('expected warning text');
		if (!primary || primary.type !== 'text') throw new Error('expected primary text');
		expect(warning.text).toContain('Multiple Storybook instances');
		expect(warning.text).toContain('pid `100`');
		expect(warning.text).toContain('pid `200`');
		expect(warning.text).toContain('(proxied)');
		expect(primary.text).toBe('PRIMARY');
		expect(response.result.isError).toBeFalsy();

		expect(response.result.content).toMatchInlineSnapshot(`
			[
			  {
			    "text": "> Warning: Multiple Storybook instances are running at this cwd. This call was proxied to pid \`100\`.
			>
			> Instances at \`/projects/foo\`:
			> - pid \`100\` at http://localhost:6007 (mcp: \`ready\`) (proxied)
			> - pid \`200\` at http://localhost:6006 (mcp: \`ready\`)
			>
			> If results look unexpected, ask the user whether they want to stop the other instance(s).",
			    "type": "text",
			  },
			  {
			    "text": "PRIMARY",
			    "type": "text",
			  },
			]
		`);
	});

	it('does not inject the multi-instance warning when only one record matches the cwd', async () => {
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo' });
		const items = response.result.content ?? [];
		expect(items).toHaveLength(1);
		const only = items[0];
		if (!only || only.type !== 'text') throw new Error('expected text content');
		expect(only.text).not.toContain('Multiple Storybook instances');
	});

	it('exposes port as an optional (not required) field on every proxied tool (but not the local control tool)', async () => {
		const server = await buildServer();
		const response = await listTools(server);
		// `clear-storybook-version-cache` is a local control op, not a proxied call,
		// so it has no routing port — only the proxied tools carry `port`.
		const proxied = response.result.tools.filter((t) => t.name !== 'clear-storybook-version-cache');
		for (const tool of proxied) {
			const props = Object.keys(tool.inputSchema.properties ?? {});
			expect(props, `tool ${tool.name} should expose port`).toContain('port');
			const required = tool.inputSchema.required ?? [];
			expect(required, `tool ${tool.name} should NOT require port`).not.toContain('port');
		}
	});

	it('routes to the instance matching both cwd and port, and does not forward port downstream', async () => {
		const a: StorybookInstanceRecordV1 = {
			...record,
			instanceId: 'inst-a',
			pid: 100,
			port: 6006,
			url: 'http://localhost:6006',
			mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
		};
		const b: StorybookInstanceRecordV1 = {
			...record,
			instanceId: 'inst-b',
			pid: 200,
			port: 6007,
			url: 'http://localhost:6007',
			mcp: { status: 'ready', endpoint: 'http://localhost:6007/mcp' },
		};
		vi.mocked(readRegistry).mockResolvedValue([a, b]);
		vi.mocked(proxyToolCall).mockResolvedValue({ content: [{ type: 'text', text: 'B' }] });

		const server = await buildServer();
		const response = await callTool(server, {
			cwd: '/projects/foo',
			port: 6007,
			withStoryIds: true,
		});

		// Selected the port-6007 instance, and `port` was stripped from upstream args.
		expect(proxyToolCall).toHaveBeenCalledWith(b, {
			name: 'list-all-documentation',
			arguments: { withStoryIds: true },
		});
		expect(firstText(response.result)).toBe('B');
	});

	it('returns the port-mismatch intercept when the cwd matches but no instance is on that port', async () => {
		const server = await buildServer();
		const response = await callTool(server, { cwd: '/projects/foo', port: 9999 });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'port-mismatch' });
		expect(firstText(response.result)).toContain('not on port `9999`');
		expect(firstText(response.result)).toContain('port `6006`');
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
