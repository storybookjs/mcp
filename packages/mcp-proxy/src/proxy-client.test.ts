import { describe, expect, it, vi } from 'vitest';
import { proxyToolCall } from './proxy-client.ts';
import type { StorybookInstanceRecord } from './types.ts';

const record: StorybookInstanceRecord = {
	pid: 1,
	cwd: '/tmp',
	url: 'http://localhost:6006',
	mcp: { ready: true, path: '/mcp' },
};

const jsonResponse = (body: unknown, init: ResponseInit = { status: 200 }) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
	});

describe('proxyToolCall', () => {
	it('POSTs a JSON-RPC tools/call request and returns the result', async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({
				jsonrpc: '2.0',
				id: 'whatever',
				result: { content: [{ type: 'text', text: 'hello' }] },
			}),
		) as unknown as typeof fetch;

		const result = await proxyToolCall(
			record,
			{ name: 'list-all-documentation', arguments: { withStoryIds: true } },
			fetchImpl,
		);

		expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);

		const call = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(call[0]).toBe('http://localhost:6006/mcp');
		const init = call[1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers.Accept).toBe('application/json');
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {
				name: 'list-all-documentation',
				arguments: { withStoryIds: true },
			},
		});
		expect(typeof body.id).toBe('string');
	});

	it('throws when the response is not ok', async () => {
		const fetchImpl = (async () =>
			new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/responded with 500/);
	});

	it('throws when the response content-type is not JSON', async () => {
		const fetchImpl = (async () =>
			new Response('event: message\ndata: {}\n\n', {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/unsupported content-type "text\/event-stream"/);
	});

	it('throws when the JSON-RPC payload carries an error', async () => {
		const fetchImpl = (async () =>
			jsonResponse({
				jsonrpc: '2.0',
				id: 'whatever',
				error: { code: -32601, message: 'unknown tool' },
			})) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/Storybook MCP error -32601: unknown tool/);
	});
});
