import { describe, expect, it, vi } from 'vitest';
import { createMcpProxyServer } from '../index.ts';
import { META_INTERCEPT_REASON } from '../intercepts.ts';
import type { ProxyDeps, ProxyToolCallResult, StorybookInstanceRecordV1 } from '../types/index.ts';

const record: StorybookInstanceRecordV1 = {
	schemaVersion: 1,
	instanceId: 'inst-1',
	pid: 1,
	cwd: '/projects/foo',
	url: 'http://localhost:6006',
	port: 6006,
	mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
};

function buildDeps(overrides: Partial<ProxyDeps> = {}): ProxyDeps {
	return {
		readRegistry: overrides.readRegistry ?? (async () => [record]),
		proxyToolCall:
			overrides.proxyToolCall ??
			(async () => ({
				content: [{ type: 'text', text: 'upstream result' }],
			})),
	};
}

async function buildServer(deps?: Partial<ProxyDeps>) {
	const server = await createMcpProxyServer({ deps: buildDeps(deps) });
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
) {
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
		const server = await buildServer({ readRegistry: async () => [] });
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(firstText(response.result)).toContain('Storybook is not running');
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
		const proxyToolCall = vi.fn<ProxyDeps['proxyToolCall']>(async () => ({
			content: [{ type: 'text', text: 'COMPONENTS' }],
		}));
		const server = await buildServer({ proxyToolCall });
		const response = await callTool(server, { cwd: '/projects/foo', withStoryIds: true });
		expect(proxyToolCall).toHaveBeenCalledWith(record, {
			name: 'list-all-documentation',
			arguments: { withStoryIds: true },
		});
		expect(firstText(response.result)).toBe('COMPONENTS');
	});

	it('dispatches mcp.status=starting to the mcp-starting intercept', async () => {
		const starting: StorybookInstanceRecordV1 = {
			...record,
			mcp: { status: 'starting' },
		};
		const server = await buildServer({ readRegistry: async () => [starting] });
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'mcp-starting' });
	});

	it('dispatches mcp.status=not-installed to the addon-missing intercept', async () => {
		const noAddon: StorybookInstanceRecordV1 = {
			...record,
			mcp: { status: 'not-installed' },
		};
		const server = await buildServer({ readRegistry: async () => [noAddon] });
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'addon-missing' });
	});

	it('dispatches mcp.status=error to the mcp-error intercept', async () => {
		const errored: StorybookInstanceRecordV1 = {
			...record,
			mcp: { status: 'error', endpoint: 'http://localhost:6006/mcp' },
		};
		const server = await buildServer({ readRegistry: async () => [errored] });
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(response.result._meta).toEqual({ [META_INTERCEPT_REASON]: 'mcp-error' });
	});

	it('surfaces a friendly error when proxyToolCall throws', async () => {
		const server = await buildServer({
			proxyToolCall: async () => {
				throw new Error('connection refused');
			},
		});
		const response = await callTool(server, { cwd: '/projects/foo' });
		expect(response.result.isError).toBe(true);
		expect(firstText(response.result)).toContain('Failed to reach Storybook MCP');
		expect(firstText(response.result)).toContain('connection refused');
	});
});
