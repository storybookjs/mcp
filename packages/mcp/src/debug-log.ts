import type { McpServer } from 'tmcp';

/**
 * Debug logging for MCP tool calls, mirroring Storybook's telemetry debugging
 * environment variables:
 *
 * - `STORYBOOK_MCP_DEBUG` — when truthy, every record is written to stderr as
 *   an NDJSON line (stderr so stdio-based MCP servers keep a clean protocol
 *   channel on stdout).
 * - `STORYBOOK_MCP_DEBUG_URL` — when set, every record is POSTed to this URL
 *   (e.g. the `mcp-logger` collector from `@hipster/sb-utils`). Setting the
 *   URL alone enables capture without the stderr noise.
 *
 * Records are fire-and-forget: emitting can never fail or slow down a tool
 * call.
 */

export type McpDebugTransport = 'addon' | 'http' | 'stdio';

export type McpDebugClientInfo = {
	name?: string;
	version?: string;
	title?: string;
};

type McpDebugRecordBase = {
	timestamp: number;
	server: { name: string; version: string; transport: McpDebugTransport };
	sessionId?: string;
	client?: McpDebugClientInfo;
};

export type McpDebugSessionRecord = McpDebugRecordBase & {
	kind: 'session-start';
	protocolVersion?: string;
	clientCapabilities?: Record<string, unknown>;
};

export type McpDebugToolCallStartRecord = McpDebugRecordBase & {
	kind: 'tool-call-start';
	callId: string;
	tool: string;
	input?: unknown;
};

export type McpDebugToolCallEndRecord = McpDebugRecordBase & {
	kind: 'tool-call-end';
	callId: string;
	tool: string;
	input?: unknown;
	durationMs: number;
	status: 'success' | 'error';
	/** The MCP tool result (content, structuredContent, isError) when the handler returned. */
	result?: unknown;
	/** Message of a thrown (uncaught) handler error. */
	errorMessage?: string;
};

export type McpDebugRecord =
	| McpDebugSessionRecord
	| McpDebugToolCallStartRecord
	| McpDebugToolCallEndRecord;

export type McpDebugConfig = {
	enabled: boolean;
	/** Collector URL records are POSTed to, from `STORYBOOK_MCP_DEBUG_URL`. */
	url?: string;
	/** Write records to stderr, from `STORYBOOK_MCP_DEBUG`. */
	logToStderr: boolean;
};

const FALSY_ENV_VALUES = new Set(['', '0', 'false']);

export function getMcpDebugConfig(
	env: Record<string, string | undefined> = process.env,
): McpDebugConfig {
	const debug = env.STORYBOOK_MCP_DEBUG?.trim().toLowerCase();
	const url = env.STORYBOOK_MCP_DEBUG_URL?.trim();
	const logToStderr = debug !== undefined && !FALSY_ENV_VALUES.has(debug);
	return {
		enabled: logToStderr || !!url,
		url: url || undefined,
		logToStderr,
	};
}

/** JSON.stringify that never throws — circular references become "[circular]". */
function safeJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'object' && val !== null) {
			if (seen.has(val)) {
				return '[circular]';
			}
			seen.add(val);
		}
		if (typeof val === 'bigint') {
			return val.toString();
		}
		return val;
	});
}

let callCounter = 0;

function nextCallId(): string {
	return `call-${Date.now().toString(36)}-${(callCounter++).toString(36)}`;
}

function emitRecord(config: McpDebugConfig, record: McpDebugRecord): void {
	let line: string;
	try {
		line = safeJsonStringify(record);
	} catch {
		return;
	}
	if (config.logToStderr) {
		process.stderr.write(`[storybook-mcp-debug] ${line}\n`);
	}
	if (config.url) {
		fetch(config.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: line,
		}).catch(() => {
			// The collector being down must never affect the MCP server.
		});
	}
}

export type InstrumentMcpServerOptions = {
	transport: McpDebugTransport;
	/** Identifies the emitting server in records (tmcp keeps its own copy private). */
	serverInfo: { name: string; version: string };
	/** Override for tests; defaults to reading `process.env`. */
	config?: McpDebugConfig;
};

/**
 * Wraps `server.tool` so every subsequently registered tool handler emits
 * `tool-call-start` / `tool-call-end` debug records, and listens for session
 * initialization to emit `session-start` records. Must be called before tools
 * are registered. No-ops (and patches nothing) when debug logging is not
 * enabled via the environment.
 */
export function instrumentMcpServerForDebug(
	server: McpServer<any, any>,
	options: InstrumentMcpServerOptions,
): void {
	const config = options.config ?? getMcpDebugConfig();
	if (!config.enabled) {
		return;
	}

	const serverInfo = {
		name: options.serverInfo.name,
		version: options.serverInfo.version,
		transport: options.transport,
	};

	const baseRecord = () => ({
		timestamp: Date.now(),
		server: serverInfo,
		sessionId: server.ctx.sessionId,
		client: server.ctx.sessionInfo?.clientInfo as McpDebugClientInfo | undefined,
	});

	server.on('initialize', (params) => {
		emitRecord(config, {
			...baseRecord(),
			kind: 'session-start',
			client: params?.clientInfo as McpDebugClientInfo | undefined,
			protocolVersion: params?.protocolVersion,
			clientCapabilities: params?.capabilities as Record<string, unknown> | undefined,
		});
	});

	const originalTool = server.tool.bind(server);
	type ToolArgs = Parameters<McpServer<any, any>['tool']>;
	type ToolHandler = (input?: unknown) => unknown;

	server.tool = ((toolOrOptions: ToolArgs[0], execute?: ToolHandler) => {
		// tmcp accepts both `tool({ ...options, execute })` and `tool(options, execute)`.
		const handler = (execute ??
			(toolOrOptions as { execute?: ToolHandler }).execute) as ToolHandler;
		const toolName = toolOrOptions.name;

		const wrappedHandler = async (input?: unknown) => {
			const callId = nextCallId();
			const startedAt = performance.now();
			emitRecord(config, {
				...baseRecord(),
				kind: 'tool-call-start',
				callId,
				tool: toolName,
				input,
			});
			const endRecord = () => ({
				...baseRecord(),
				kind: 'tool-call-end' as const,
				callId,
				tool: toolName,
				input,
				durationMs: Math.round(performance.now() - startedAt),
			});
			try {
				const result = await (input === undefined ? handler() : handler(input));
				emitRecord(config, {
					...endRecord(),
					status: (result as { isError?: boolean } | undefined)?.isError ? 'error' : 'success',
					result,
				});
				return result;
			} catch (error) {
				emitRecord(config, {
					...endRecord(),
					status: 'error',
					errorMessage: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		};

		if (execute) {
			return originalTool(toolOrOptions as never, wrappedHandler as never);
		}
		return originalTool({ ...toolOrOptions, execute: wrappedHandler } as never);
	}) as McpServer<any, any>['tool'];
}
