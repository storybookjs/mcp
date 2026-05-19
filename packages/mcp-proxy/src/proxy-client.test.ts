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

const sseResponse = (body: string, init: ResponseInit = { status: 200 }) =>
	new Response(body, {
		...init,
		headers: { 'Content-Type': 'text/event-stream', ...(init.headers ?? {}) },
	});

describe('proxyToolCall', () => {
	it('POSTs a JSON-RPC tools/call request and returns the result (application/json)', async () => {
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
		expect(headers.Accept).toBe('application/json, text/event-stream');
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

	it('parses a single-event SSE response (text/event-stream)', async () => {
		const sseBody =
			'event: message\n' +
			'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hi"}]}}\n' +
			'\n';
		const fetchImpl = (async () => sseResponse(sseBody)) as typeof fetch;

		const result = await proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl);
		expect(result.content).toEqual([{ type: 'text', text: 'hi' }]);
	});

	it('joins multi-line SSE data correctly', async () => {
		const envelope = {
			jsonrpc: '2.0',
			id: 1,
			result: { content: [{ type: 'text', text: 'line\nwith newline' }] },
		};
		const dataLines = JSON.stringify(envelope).split('\n').map((l) => `data: ${l}`).join('\n');
		const sseBody = `event: message\n${dataLines}\n\n`;
		const fetchImpl = (async () => sseResponse(sseBody)) as typeof fetch;

		const result = await proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl);
		expect(result.content[0]).toEqual({ type: 'text', text: 'line\nwith newline' });
	});

	it('throws on SSE responses that contain no data event', async () => {
		const fetchImpl = (async () => sseResponse('event: ping\n\n')) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/SSE response with no data event/);
	});

	it('throws when the response is not ok', async () => {
		const fetchImpl = (async () =>
			new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/responded with 500/);
	});

	it('throws when the response content-type is neither JSON nor SSE', async () => {
		const fetchImpl = (async () =>
			new Response('<html></html>', {
				status: 200,
				headers: { 'Content-Type': 'text/html' },
			})) as typeof fetch;
		await expect(
			proxyToolCall(record, { name: 'list-all-documentation' }, fetchImpl),
		).rejects.toThrow(/unsupported content-type "text\/html"/);
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
