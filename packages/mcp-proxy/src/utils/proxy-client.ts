import type {
	ProxyToolCallParams,
	ProxyToolCallResult,
	StorybookInstanceRecordV1,
} from '../types/index.ts';

const STORYBOOK_MCP_PROXY_HEADER = 'X-Storybook-MCP-Proxy';
const STORYBOOK_MCP_PROXY_HEADER_VALUE = 'true';

/**
 * Forward an MCP `tools/call` JSON-RPC request to a local Storybook MCP server.
 *
 * The downstream is `@storybook/addon-mcp` over HTTP at `record.mcp.endpoint`.
 * tmcp's HttpTransport hardcodes `text/event-stream` for any request with an
 * id, so we accept both content-types and parse the SSE envelope when needed.
 * The proxy is stateless; every call is independent and we don't need session
 * bookkeeping.
 */
export async function proxyToolCall(
	record: StorybookInstanceRecordV1,
	params: ProxyToolCallParams,
	fetchImpl: typeof fetch = fetch,
): Promise<ProxyToolCallResult> {
	const endpoint = record.mcp.endpoint;
	if (!endpoint) {
		throw new Error(`Storybook MCP record for ${record.cwd} is missing mcp.endpoint`);
	}

	const response = await fetchImpl(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			[STORYBOOK_MCP_PROXY_HEADER]: STORYBOOK_MCP_PROXY_HEADER_VALUE,
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
