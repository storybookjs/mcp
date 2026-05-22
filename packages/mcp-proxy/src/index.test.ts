import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { createMcpProxyServer } from './index.ts';
import { readRegistry } from './utils/registry.ts';
import type { ProxyToolCallResult, StorybookInstanceRecordV1 } from './types/index.ts';

vi.mock('./utils/registry.ts', () => ({
	readRegistry: vi.fn().mockResolvedValue([]),
	DEFAULT_REGISTRY_DIR: '/tmp/mcp-proxy-test-default-registry',
}));

const CLIENT_INFO = { name: 'test-client', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

const FIXTURES = join(__dirname, '..', '__fixtures__', 'workspace');
const PNPM_MONOREPO = join(FIXTURES, 'pnpm-monorepo');
const EMPTY_MONOREPO = join(FIXTURES, 'empty-monorepo');

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

function callToolRequest(cwd: string, extra: Record<string, unknown> = {}, id = 2) {
	return {
		jsonrpc: '2.0' as const,
		id,
		method: 'tools/call',
		params: {
			name: 'list-all-documentation',
			arguments: { cwd, ...extra },
		},
	};
}

type CapturedRequest = {
	url: string;
	body: { jsonrpc: string; id: string | number; method: string; params: unknown };
};

async function startFakeAddon(
	respond: (req: CapturedRequest) => { contentType: 'json' | 'sse'; result: ProxyToolCallResult },
) {
	const captured: CapturedRequest[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
			const captureEntry: CapturedRequest = { url: req.url ?? '/', body };
			captured.push(captureEntry);
			const { contentType, result } = respond(captureEntry);
			const envelope = { jsonrpc: '2.0', id: body.id, result };
			if (contentType === 'json') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(envelope));
			} else {
				res.writeHead(200, { 'Content-Type': 'text/event-stream' });
				res.end(`data: ${JSON.stringify(envelope)}\n\n`);
			}
		});
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('unexpected server address');
	const endpoint = `http://127.0.0.1:${address.port}/mcp`;

	return {
		endpoint,
		captured,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function firstText(result: ProxyToolCallResult): string {
	const item = result.content?.[0];
	if (!item || item.type !== 'text') throw new Error('expected text content');
	return item.text;
}

describe('createMcpProxyServer', () => {
	let addon: Awaited<ReturnType<typeof startFakeAddon>>;

	beforeAll(async () => {
		addon = await startFakeAddon(({ body }) => {
			const params = body.params as { name: string; arguments?: Record<string, unknown> };
			return {
				contentType: 'sse',
				result: {
					content: [
						{
							type: 'text',
							text: `addon received ${params.name} with ${JSON.stringify(params.arguments ?? {})}`,
						},
					],
				},
			};
		});
	});

	afterAll(async () => {
		await addon.close();
	});

	afterEach(() => {
		vi.mocked(readRegistry).mockReset();
		vi.mocked(readRegistry).mockResolvedValue([]);
	});

	it('responds to initialize with server metadata and instructions', async () => {
		const server = await createMcpProxyServer();

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
		const server = await createMcpProxyServer();

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

	it('forwards a tools/call through the full proxy → registry → addon-mcp path', async () => {
		const projectCwd = PNPM_MONOREPO;
		const record: StorybookInstanceRecordV1 = {
			schemaVersion: 1,
			instanceId: 'e2e-instance',
			pid: process.pid,
			cwd: projectCwd,
			url: 'http://localhost:6006',
			port: 6006,
			mcp: { status: 'ready', endpoint: addon.endpoint },
		};
		vi.mocked(readRegistry).mockResolvedValue([record]);

		const server = await createMcpProxyServer();
		await server.receive(initializeRequest());

		const response = (await server.receive(
			callToolRequest(projectCwd, { withStoryIds: true }) as never,
		)) as { result: ProxyToolCallResult };

		expect(firstText(response.result)).toBe(
			'addon received list-all-documentation with {"withStoryIds":true}',
		);

		expect(addon.captured).toHaveLength(1);
		expect(addon.captured[0]!.body).toMatchObject({
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {
				name: 'list-all-documentation',
				arguments: { withStoryIds: true },
			},
		});
		// cwd is consumed by the proxy and must not leak downstream.
		expect(
			(addon.captured[0]!.body.params as { arguments?: Record<string, unknown> }).arguments,
		).not.toHaveProperty('cwd');
	});

	describe('monorepo-aware no-instance intercept (real workspace discovery)', () => {
		it('lists the real workspace packages of a pnpm monorepo when called at its root', async () => {
			const server = await createMcpProxyServer();
			await server.receive(initializeRequest());

			const response = (await server.receive(callToolRequest(PNPM_MONOREPO) as never)) as {
				result: ProxyToolCallResult;
			};

			expect(response.result.isError).toBe(true);
			const text = firstText(response.result);
			expect(text).toContain('Workspace packages in this monorepo');
			// All non-negated workspace packages should appear.
			expect(text).toContain('@fixture/has-sb');
			expect(text).toContain('@fixture/has-addon');
			expect(text).toContain('@fixture/no-sb');
			expect(text).toContain('@fixture/web-app');
			// Negated package must not appear.
			expect(text).not.toContain('@fixture/skip-me');
			// Per-package addon-mcp install state is rendered.
			expect(text).toContain('npx storybook add @storybook/addon-mcp');
		});

		it('omits the workspace section when called from a nested package cwd', async () => {
			const nested = join(PNPM_MONOREPO, 'packages', 'has-sb');
			const server = await createMcpProxyServer();
			await server.receive(initializeRequest());

			const response = (await server.receive(callToolRequest(nested) as never)) as {
				result: ProxyToolCallResult;
			};

			expect(response.result.isError).toBe(true);
			const text = firstText(response.result);
			expect(text).not.toContain('Workspace packages in this monorepo');
			expect(text).not.toContain('@fixture/web-app');
		});

		it('asks the user when no workspace package has Storybook installed', async () => {
			const server = await createMcpProxyServer();
			await server.receive(initializeRequest());

			const response = (await server.receive(callToolRequest(EMPTY_MONOREPO) as never)) as {
				result: ProxyToolCallResult;
			};

			expect(response.result.isError).toBe(true);
			const text = firstText(response.result);
			expect(text).toContain('No package in this monorepo has Storybook installed');
			expect(text).toContain('Ask the user which package');
			expect(text).toContain('@empty/a');
			expect(text).toContain('@empty/b');
		});

		it('still lists running Storybook cwds alongside the monorepo packages', async () => {
			const runningCwd = '/somewhere/else';
			const record: StorybookInstanceRecordV1 = {
				schemaVersion: 1,
				instanceId: 'other',
				pid: process.pid,
				cwd: runningCwd,
				url: 'http://localhost:6007',
				port: 6007,
				mcp: { status: 'ready', endpoint: addon.endpoint },
			};
			vi.mocked(readRegistry).mockResolvedValue([record]);

			const server = await createMcpProxyServer();
			await server.receive(initializeRequest());

			const response = (await server.receive(callToolRequest(PNPM_MONOREPO) as never)) as {
				result: ProxyToolCallResult;
			};

			expect(response.result.isError).toBe(true);
			const text = firstText(response.result);
			expect(text).toContain('Running Storybooks');
			expect(text).toContain(runningCwd);
			expect(text).toContain('@fixture/has-sb');
		});
	});
});
