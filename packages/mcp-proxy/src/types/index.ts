import type { CallToolResult } from 'tmcp';

export type { McpStatusV1, StorybookInstanceRecordV1 } from './record/v1.ts';
export { McpStatusV1Schema, StorybookInstanceRecordV1Schema } from './record/v1.ts';

export type InterceptReason =
	| 'no-instance'
	| 'addon-missing'
	| 'mcp-starting'
	| 'mcp-error'
	| 'invalid-cwd'
	| 'storybook-too-old';

export type ProxyToolCallParams = {
	name: string;
	arguments?: Record<string, unknown>;
};

export type ProxyToolCallResult = CallToolResult<undefined>;
