import { describe, expect, it, vi } from 'vitest';
import { createMcpProxyServer } from '../index.ts';
import { META_FALLBACK_INSTANCE, META_INTERCEPT_REASON } from '../intercepts.ts';
import type {
	ProxyContext,
	ProxyDeps,
	ProxyToolCallResult,
	StorybookInstanceRecord,
} from '../types.ts';

const record: StorybookInstanceRecord = {
	pid: 1,
	cwd: '/projects/foo',
	url: 'http://localhost:6006',
	mcp: { ready: true, path: '/mcp' },
};

function buildDeps(overrides: Partial<ProxyDeps> = {}): ProxyDeps {
	return {
		readRegistry: overrides.readRegistry ?? (async () => [record]),
		proxyToolCall:
			overrides.proxyToolCall ??
			(async () => ({
				content: [{ type: 'text', text: 'upstream result' }],
			})),
		cwd: overrides.cwd ?? (() => '/projects/foo'),
	};
}

async function buildServer(deps?: Partial<ProxyDeps>) {
	const server = await createMcpProxyServer({ deps: buildDeps(deps) });
	await server.receive({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 't', version: '0' },
		},
	} as never);
	return server;
}

async function listTools(server: Awaited<ReturnType<typeof createMcpProxyServer>>) {
	return (await server.receive({
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
		params: {},
	} as never)) as { result: { tools: Array<{ name: string; inputSchema: any }> } };
}

async function callTool(
	server: Awaited<ReturnType<typeof createMcpProxyServer>>,
	args: Record<string, unknown>,
	ctx?: { custom?: ProxyContext },
) {
	return (await server.receive(
		{
			jsonrpc: '2.0',
			id: 3,
			method: 'tools/call',
			params: { name: 'list-all-documentation', arguments: args },
		} as never,
		ctx as never,
	)) as { result: ProxyToolCallResult };
}

describe('registerProxyTool / list-all-documentation', () => {
	it('exposes list-all-documentation with cwd appended to the schema', async () => {
		const server = await buildServer();
		const response = await listTools(server);
		const tool = response.result.tools.find((t) => t.name === 'list-all-documentation');
		expect(tool).toBeTruthy();
		const props = Object.keys(tool!.inputSchema.properties);
		expect(props).toContain('withStoryIds');
		expect(props).toContain('cwd');
	});

	it('returns the no-instance intercept when the registry is empty', async () => {
		const server = await buildServer({ readRegistry: async () => [] });
		const response = await callTool(server, {});
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(response.result.content[0]!.text).toContain('Storybook is not running');
	});

	it('proxies tool args downstream and forwards the upstream result', async () => {
		const proxyToolCall = vi.fn<ProxyDeps['proxyToolCall']>(async () => ({
			content: [{ type: 'text', text: 'COMPONENTS' }],
		}));
		const server = await buildServer({ proxyToolCall });
		const response = await callTool(server, { withStoryIds: true });
		expect(proxyToolCall).toHaveBeenCalledWith(record, {
			name: 'list-all-documentation',
			arguments: { withStoryIds: true },
		});
		expect(response.result.content[0]!.text).toBe('COMPONENTS');
		expect(response.result._meta?.[META_FALLBACK_INSTANCE]).toBeUndefined();
	});

	it('prepends a fallback preamble and flags _meta when matching by fallback', async () => {
		const server = await buildServer({ cwd: () => '/elsewhere' });
		const response = await callTool(server, {});
		expect(response.result.content[0]!.text).toContain('Falling back');
		expect(response.result._meta).toEqual({ [META_FALLBACK_INSTANCE]: record.cwd });
	});

	it('surfaces a friendly error when proxyToolCall throws', async () => {
		const server = await buildServer({
			proxyToolCall: async () => {
				throw new Error('connection refused');
			},
		});
		const response = await callTool(server, {});
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0]!.text).toContain('Failed to reach Storybook MCP');
		expect(response.result.content[0]!.text).toContain('connection refused');
	});

	it('prefers the explicit cwd arg over the deps fallback', async () => {
		const altRecord: StorybookInstanceRecord = {
			...record,
			cwd: '/projects/bar',
			url: 'http://localhost:6007',
		};
		const proxyToolCall = vi.fn<ProxyDeps['proxyToolCall']>(async () => ({
			content: [{ type: 'text', text: 'bar' }],
		}));
		const server = await buildServer({
			readRegistry: async () => [record, altRecord],
			cwd: () => '/projects/foo',
			proxyToolCall,
		});
		await callTool(server, { cwd: '/projects/bar/src' });
		expect(proxyToolCall).toHaveBeenCalledTimes(1);
		expect(proxyToolCall.mock.calls[0]![0].cwd).toBe('/projects/bar');
	});
});
