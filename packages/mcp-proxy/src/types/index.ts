import type { CallToolResult } from 'tmcp';
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

export type ProxyToolCallResult = CallToolResult<undefined>;

export type ProxyDeps = {
	readRegistry: () => Promise<StorybookInstanceRecordV1[]>;
	proxyToolCall: (
		record: StorybookInstanceRecordV1,
		params: ProxyToolCallParams,
	) => Promise<ProxyToolCallResult>;
};
