import type { ProxyToolCallParams, ProxyToolCallResult, StorybookInstanceRecord } from './types.ts';

/**
 * Forward an MCP `tools/call` JSON-RPC request to a local Storybook MCP server.
 *
 * The downstream server is `@storybook/addon-mcp` over HTTP at
 * `${record.url}${record.mcp.path}`. We use bare fetch rather than depending on
 * a full MCP client because this proxy is stdio-fronted and stateless — every
 * call is independent and we don't need session bookkeeping on this side.
 *
 * The JSON-RPC `id` is unique per call (UUID) so logs stay disambiguatable, but
 * the proxy never inspects it on the way back — the response body is read off
 * the awaited fetch directly.
 */
export async function proxyToolCall(
	record: StorybookInstanceRecord,
	params: ProxyToolCallParams,
	fetchImpl: typeof fetch = fetch,
): Promise<ProxyToolCallResult> {
	const endpoint = new URL(record.mcp.path, record.url).toString();

	const response = await fetchImpl(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: crypto.randomUUID(),
			method: 'tools/call',
			params,
		}),
	});

	if (!response.ok) {
		throw new Error(
			`Storybook MCP at ${endpoint} responded with ${response.status} ${response.statusText}`,
		);
	}

	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/json')) {
		throw new Error(
			`Storybook MCP at ${endpoint} returned unsupported content-type "${contentType}". The proxy currently only accepts JSON responses.`,
		);
	}

	const payload = (await response.json()) as {
		result?: ProxyToolCallResult;
		error?: { code: number; message: string };
	};

	if (payload.error) {
		throw new Error(`Storybook MCP error ${payload.error.code}: ${payload.error.message}`);
	}
	if (!payload.result) {
		throw new Error('Storybook MCP returned no result');
	}
	return payload.result;
}
