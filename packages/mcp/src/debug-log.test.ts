import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import * as v from 'valibot';
import {
	getMcpDebugConfig,
	instrumentMcpServerForDebug,
	type McpDebugRecord,
} from './debug-log.ts';

const SERVER_INFO = { name: 'test-server', version: '1.0.0' };

function createServer() {
	return new McpServer(
		{ ...SERVER_INFO, description: 'Test server for debug logging' },
		{
			adapter: new ValibotJsonSchemaAdapter(),
			capabilities: { tools: { listChanged: true } },
		},
	).withContext<Record<string, never>>();
}

async function initializeSession(server: ReturnType<typeof createServer>, sessionId: string) {
	await server.receive(
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'test-client', version: '2.0.0' },
			},
		},
		{ sessionId },
	);
}

function callTool(
	server: ReturnType<typeof createServer>,
	name: string,
	args: Record<string, unknown>,
	sessionId = 'test-session',
) {
	return server.receive(
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: { name, arguments: args },
		},
		{ sessionId },
	);
}

describe('getMcpDebugConfig', () => {
	it('is disabled when neither variable is set', () => {
		expect(getMcpDebugConfig({})).toEqual({
			enabled: false,
			url: undefined,
			logToStderr: false,
		});
	});

	it.each(['1', 'true', 'anything'])(
		'enables stderr logging for STORYBOOK_MCP_DEBUG=%s',
		(value) => {
			expect(getMcpDebugConfig({ STORYBOOK_MCP_DEBUG: value })).toEqual({
				enabled: true,
				url: undefined,
				logToStderr: true,
			});
		},
	);

	it.each(['', '0', 'false', 'FALSE'])(
		'stays disabled for falsy STORYBOOK_MCP_DEBUG=%j',
		(value) => {
			expect(getMcpDebugConfig({ STORYBOOK_MCP_DEBUG: value }).enabled).toBe(false);
		},
	);

	it('enables capture when only STORYBOOK_MCP_DEBUG_URL is set', () => {
		expect(getMcpDebugConfig({ STORYBOOK_MCP_DEBUG_URL: 'http://localhost:6008/mcp-log' })).toEqual(
			{
				enabled: true,
				url: 'http://localhost:6008/mcp-log',
				logToStderr: false,
			},
		);
	});

	it('supports both variables at once', () => {
		expect(
			getMcpDebugConfig({
				STORYBOOK_MCP_DEBUG: '1',
				STORYBOOK_MCP_DEBUG_URL: 'http://localhost:6008/mcp-log',
			}),
		).toEqual({
			enabled: true,
			url: 'http://localhost:6008/mcp-log',
			logToStderr: true,
		});
	});
});

describe('instrumentMcpServerForDebug', () => {
	let server: ReturnType<typeof createServer>;
	let fetchMock: ReturnType<typeof vi.fn>;
	let posted: McpDebugRecord[];

	const URL_CONFIG = {
		enabled: true,
		url: 'http://localhost:6008/mcp-log',
		logToStderr: false,
	};

	beforeEach(() => {
		server = createServer();
		posted = [];
		fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
			posted.push(JSON.parse(init.body));
			return new Response('OK');
		});
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function addEchoTool(handler?: (input: { message: string }) => unknown) {
		server.tool(
			{
				name: 'echo',
				description: 'Echoes the input',
				schema: v.object({ message: v.string() }),
			},
			(async (input: { message: string }) =>
				handler ? handler(input) : { content: [{ type: 'text', text: input.message }] }) as never,
		);
	}

	it('does not patch the server when disabled', () => {
		const originalTool = server.tool;
		instrumentMcpServerForDebug(server, {
			transport: 'http',
			serverInfo: SERVER_INFO,
			config: { enabled: false, logToStderr: false },
		});
		expect(server.tool).toBe(originalTool);
	});

	it('emits start and end records for a successful tool call', async () => {
		instrumentMcpServerForDebug(server, {
			transport: 'http',
			serverInfo: SERVER_INFO,
			config: URL_CONFIG,
		});
		addEchoTool();
		await initializeSession(server, 'session-a');

		const response = await callTool(server, 'echo', { message: 'hello' }, 'session-a');
		expect(response.result.content).toEqual([{ type: 'text', text: 'hello' }]);

		// session-start + tool-call-start + tool-call-end
		expect(posted.map((r) => r.kind)).toEqual([
			'session-start',
			'tool-call-start',
			'tool-call-end',
		]);

		const [sessionStart, start, end] = posted as [
			Extract<McpDebugRecord, { kind: 'session-start' }>,
			Extract<McpDebugRecord, { kind: 'tool-call-start' }>,
			Extract<McpDebugRecord, { kind: 'tool-call-end' }>,
		];

		expect(sessionStart.client).toEqual({ name: 'test-client', version: '2.0.0' });
		expect(sessionStart.protocolVersion).toBe('2025-06-18');
		expect(sessionStart.sessionId).toBe('session-a');

		expect(start.tool).toBe('echo');
		expect(start.input).toEqual({ message: 'hello' });
		expect(start.sessionId).toBe('session-a');
		expect(start.server).toEqual({ ...SERVER_INFO, transport: 'http' });

		expect(end.callId).toBe(start.callId);
		expect(end.status).toBe('success');
		expect(end.durationMs).toBeTypeOf('number');
		expect(end.result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
	});

	it('marks results with isError as errors', async () => {
		instrumentMcpServerForDebug(server, {
			transport: 'addon',
			serverInfo: SERVER_INFO,
			config: URL_CONFIG,
		});
		addEchoTool(() => ({
			content: [{ type: 'text', text: 'Component not found' }],
			isError: true,
		}));

		await callTool(server, 'echo', { message: 'nope' });

		const end = posted.find((r) => r.kind === 'tool-call-end');
		expect(end).toMatchObject({ status: 'error', tool: 'echo' });
	});

	it('records thrown handler errors and rethrows them', async () => {
		instrumentMcpServerForDebug(server, {
			transport: 'http',
			serverInfo: SERVER_INFO,
			config: URL_CONFIG,
		});
		addEchoTool(() => {
			throw new Error('boom');
		});

		const response = await callTool(server, 'echo', { message: 'x' });
		// tmcp surfaces uncaught handler errors as JSON-RPC errors
		expect(response.error).toBeDefined();

		const end = posted.find((r) => r.kind === 'tool-call-end');
		expect(end).toMatchObject({ status: 'error', errorMessage: 'boom' });
		expect((end as { result?: unknown }).result).toBeUndefined();
	});

	it('never lets collector failures break the tool call', async () => {
		fetchMock.mockRejectedValue(new Error('collector down'));
		instrumentMcpServerForDebug(server, {
			transport: 'http',
			serverInfo: SERVER_INFO,
			config: URL_CONFIG,
		});
		addEchoTool();

		const response = await callTool(server, 'echo', { message: 'still works' });
		expect(response.result.content).toEqual([{ type: 'text', text: 'still works' }]);
	});

	it('writes NDJSON lines to stderr when STORYBOOK_MCP_DEBUG is on', async () => {
		const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		try {
			instrumentMcpServerForDebug(server, {
				transport: 'stdio',
				serverInfo: SERVER_INFO,
				config: { enabled: true, logToStderr: true },
			});
			addEchoTool();

			await callTool(server, 'echo', { message: 'hi' });

			const lines = stderrSpy.mock.calls.map(([chunk]) => String(chunk));
			expect(lines).toHaveLength(2);
			for (const line of lines) {
				expect(line.startsWith('[storybook-mcp-debug] ')).toBe(true);
				expect(() => JSON.parse(line.replace('[storybook-mcp-debug] ', ''))).not.toThrow();
			}
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			stderrSpy.mockRestore();
		}
	});
});
