import type { StorybookInstanceRecordV1 } from './record/v1.ts';

export type { McpStatusV1, StorybookInstanceRecordV1 } from './record/v1.ts';
export { McpStatusV1Schema, StorybookInstanceRecordV1Schema } from './record/v1.ts';

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
	readRegistry: () => Promise<StorybookInstanceRecordV1[]>;
	proxyToolCall: (
		record: StorybookInstanceRecordV1,
		params: ProxyToolCallParams,
	) => Promise<ProxyToolCallResult>;
};
