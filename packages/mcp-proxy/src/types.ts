import * as v from 'valibot';

/**
 * MCP readiness state for a Storybook instance. Source: `mcp.status` enum in
 * storybookjs/storybook#34826.
 */
export const McpStatusSchema = v.picklist(['not-installed', 'starting', 'ready', 'error']);
export type McpStatus = v.InferOutput<typeof McpStatusSchema>;

/**
 * Schema of a single Storybook runtime record written under the registry dir
 * (default `~/.storybook/instances`). One file per running `storybook dev`
 * instance. Spec: storybookjs/storybook#34826.
 */
export const StorybookInstanceRecordSchema = v.object({
	schemaVersion: v.number(),
	instanceId: v.string(),
	pid: v.number(),
	cwd: v.string(),
	url: v.string(),
	port: v.number(),
	storybookVersion: v.optional(v.string()),
	startedAt: v.optional(v.string()),
	updatedAt: v.optional(v.string()),
	mcp: v.object({
		status: McpStatusSchema,
		endpoint: v.optional(v.string()),
	}),
});
export type StorybookInstanceRecord = v.InferOutput<typeof StorybookInstanceRecordSchema>;

export type InterceptReason =
	| 'no-instance'
	| 'addon-missing'
	| 'mcp-starting'
	| 'mcp-error'
	| 'multiple-matches';

export type ProxyToolCallParams = {
	name: string;
	arguments?: Record<string, unknown>;
};

export type ProxyToolCallResult = {
	content: Array<{ type: string; text?: string; [key: string]: unknown }>;
	isError?: boolean;
	structuredContent?: unknown;
	_meta?: Record<string, unknown>;
	[key: string]: unknown;
};

export type ProxyDeps = {
	readRegistry: () => Promise<StorybookInstanceRecord[]>;
	proxyToolCall: (
		record: StorybookInstanceRecord,
		params: ProxyToolCallParams,
	) => Promise<ProxyToolCallResult>;
};
