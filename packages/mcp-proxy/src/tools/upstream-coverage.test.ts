import { describe, expect, it } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { registerProxiedTools } from './index.ts';
import * as addonToolNames from '@storybook/addon-mcp/tool-names';
import * as storybookMcp from '@storybook/mcp';

/** Pull every exported `*_TOOL_NAME` string constant out of a module namespace. */
function toolNamesOf(mod: Record<string, unknown>): string[] {
	return Object.entries(mod)
		.filter(([key, value]) => key.endsWith('TOOL_NAME') && typeof value === 'string')
		.map(([, value]) => value as string);
}

const UPSTREAM_TOOL_NAMES = [...toolNamesOf(addonToolNames), ...toolNamesOf(storybookMcp)];

const PROXY_SPECIFIC_TOOL_NAMES = new Set<string>(['clear-storybook-version-cache']);

const INTENTIONALLY_NOT_PROXIED = new Set<string>(['display-review']);

async function listProxiedToolNames(): Promise<string[]> {
	const server = new McpServer(
		{ name: 'test', version: '0.0.0', description: 'test' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	);
	registerProxiedTools(server, '/tmp/test-registry');
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
	const response = (await server.receive({
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/list',
		params: {},
	} as never)) as { result: { tools: Array<{ name: string }> } };
	return response.result.tools.map((tool) => tool.name);
}

describe('proxy upstream tool coverage', () => {
	it('registers every upstream tool that is not explicitly excluded', async () => {
		const proxied = new Set(await listProxiedToolNames());

		const missing = UPSTREAM_TOOL_NAMES.filter(
			(name) => !proxied.has(name) && !INTENTIONALLY_NOT_PROXIED.has(name),
		);

		expect(
			missing,
			`Upstream tool(s) ${JSON.stringify(missing)} are not registered in the proxy. ` +
				`Add them in src/tools/index.ts (and duplicate their schema in shared.ts), ` +
				`or add them to INTENTIONALLY_NOT_PROXIED with a reason.`,
		).toEqual([]);
	});

	it.runIf(INTENTIONALLY_NOT_PROXIED.size > 0)('only excludes tools that still exist upstream', () => {
		const upstream = new Set(UPSTREAM_TOOL_NAMES);
		const stale = [...INTENTIONALLY_NOT_PROXIED].filter((name) => !upstream.has(name));

		expect(
			stale,
			`INTENTIONALLY_NOT_PROXIED references tool(s) ${JSON.stringify(stale)} that no longer ` +
				`exist upstream. Remove them from the exclusion list.`,
		).toEqual([]);
	});

	it('does not proxy a tool that has no upstream counterpart', async () => {
		const upstream = new Set(UPSTREAM_TOOL_NAMES);
		const orphaned = (await listProxiedToolNames()).filter(
			(name) => !PROXY_SPECIFIC_TOOL_NAMES.has(name) && !upstream.has(name),
		);

		expect(
			orphaned,
			`Proxy exposes tool(s) ${JSON.stringify(orphaned)} that no upstream package defines. ` +
				`Either they were renamed/removed upstream, or they are new proxy-specific ` +
				`tools (add them to PROXY_SPECIFIC_TOOL_NAMES).`,
		).toEqual([]);
	});
});
