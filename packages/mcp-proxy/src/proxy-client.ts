import type { ProxyToolCallParams, ProxyToolCallResult, StorybookInstanceRecord } from './types.ts';

/**
 * Forward an MCP `tools/call` JSON-RPC request to a local Storybook MCP server.
 *
 * The downstream server is `@storybook/addon-mcp` over HTTP at
 * `${record.url}${record.mcp.path}`. tmcp's HttpTransport responds either with
 * `application/json` or `text/event-stream` (MCP Streamable HTTP) depending on
 * the Accept header. We send both and decode either, since a single tools/call
 * response always fits in one SSE message anyway — we don't need a true streaming
 * reader on this side.
 *
 * The proxy is stdio-fronted and stateless; every call is independent and we
 * don't need session bookkeeping. The JSON-RPC `id` is fresh per call so logs
 * stay disambiguatable, but we never inspect it on the way back — the response
 * body is read off the awaited fetch directly.
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
			Accept: 'application/json, text/event-stream',
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

	const payload = (await readJsonRpcResponse(response, endpoint)) as {
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

async function readJsonRpcResponse(response: Response, endpoint: string): Promise<unknown> {
	const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

	if (contentType.includes('application/json')) {
		return await response.json();
	}

	if (contentType.includes('text/event-stream')) {
		return parseSseEnvelope(await response.text(), endpoint);
	}

	throw new Error(
		`Storybook MCP at ${endpoint} returned unsupported content-type "${contentType}". Expected application/json or text/event-stream.`,
	);
}

/**
 * Parse an MCP Streamable HTTP SSE response containing a single JSON-RPC envelope.
 * Format per the SSE spec: lines starting with `data:` hold payload bytes; multiple
 * `data:` lines in one event are joined with `\n`; the event terminates at the first
 * blank line. We only care about the first event because a tools/call response is
 * always a single message.
 */
function parseSseEnvelope(body: string, endpoint: string): unknown {
	const dataLines: string[] = [];
	for (const rawLine of body.split('\n')) {
		const line = rawLine.replace(/\r$/, '');
		if (line.startsWith('data:')) {
			// SSE allows an optional space after the colon; strip at most one.
			const value = line.slice(5);
			dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
			continue;
		}
		if (line === '' && dataLines.length > 0) break;
	}
	if (dataLines.length === 0) {
		throw new Error(`Storybook MCP at ${endpoint} returned an SSE response with no data event`);
	}
	try {
		return JSON.parse(dataLines.join('\n'));
	} catch (error) {
		throw new Error(
			`Storybook MCP at ${endpoint} returned an SSE event whose data could not be parsed as JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
