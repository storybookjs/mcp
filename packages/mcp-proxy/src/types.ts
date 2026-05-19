/**
 * Schema of a single Storybook runtime record written under the registry dir
 * (default `~/.storybook`). One file per running `storybook dev` instance.
 *
 * NOTE: This shape is provisional. The Storybook-core write side is not yet
 * implemented; the final schema must be agreed with the Storybook team before
 * the proxy goes beyond stub behaviour.
 */
export type StorybookInstanceRecord = {
	/** PID of the `storybook dev` process. Used for liveness checks. */
	pid: number;
	/** Absolute path to the project root (the cwd `storybook dev` was started from). */
	cwd: string;
	/** Origin where the dev server is serving, e.g. `http://localhost:6006`. */
	url: string;
	/** MCP readiness state for this instance. */
	mcp: {
		/** True once `@storybook/addon-mcp` has finished initialising. */
		ready: boolean;
		/** Path under `url` where the MCP HTTP transport listens, e.g. `/mcp`. */
		path: string;
	};
	/** Storybook version, if known. */
	version?: string;
	/** ISO timestamp when the record was written. */
	startedAt?: string;
};

export type ProxyContext = {
	/**
	 * Absolute filesystem path the agent considers "current" for this call.
	 * Falls back to the proxy process's `process.cwd()` when omitted.
	 * Reserved for embedders; the stdio bin path never populates it.
	 */
	cwd?: string;
};

export type InterceptReason =
	| 'no-instance'
	| 'no-launch-config'
	| 'addon-missing'
	| 'storybook-outdated'
	| 'mcp-starting'
	| 'multiple-matches';

export type ProxyToolCallParams = {
	name: string;
	arguments?: Record<string, unknown>;
};

export type ProxyToolCallContent = {
	type: string;
	text?: string;
	[key: string]: unknown;
};

export type ProxyToolCallResult = {
	content: ProxyToolCallContent[];
	isError?: boolean;
	structuredContent?: unknown;
	_meta?: Record<string, unknown>;
	[key: string]: unknown;
};

/**
 * Injectable dependencies the proxy server uses at request time. Exposed so
 * tests (and embedders) can stub registry reads and HTTP calls without spinning
 * up a real Storybook.
 */
export type ProxyDeps = {
	readRegistry: () => Promise<StorybookInstanceRecord[]>;
	proxyToolCall: (
		record: StorybookInstanceRecord,
		params: ProxyToolCallParams,
	) => Promise<ProxyToolCallResult>;
	cwd: () => string;
};
