import type { InterceptReason, StorybookInstanceRecordV1 } from './types/index.ts';

/**
 * Namespaced `_meta` key. MCP reserves unprefixed and `mcp.*` /
 * `modelcontextprotocol.*` / `anthropic.*` keys; everything else should live
 * under a reverse-DNS-like prefix to keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';

const NO_INSTANCE_EMPTY = `Storybook is not running. Start \`storybook dev\` in the project root and retry the tool call.`;

const buildNoInstanceWithCandidates = (records: StorybookInstanceRecordV1[]) =>
	`No Storybook is running at this cwd. Either start \`storybook dev\` from the project's cwd, or retry with one of the running cwds below.

Running Storybooks:
${records.map((r) => `- \`${r.cwd}\` (${r.url})`).join('\n')}`;

const ADDON_MISSING = `Storybook is running but does not expose an MCP server. The \`@storybook/addon-mcp\` addon is missing.

Install it:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`

Restart Storybook, then retry the tool call.`;

const MCP_STARTING = `Storybook is running but its MCP server is still starting up. Wait a moment and retry the tool call.`;

const MCP_ERROR = `Storybook is running but its MCP server reported an error. Inspect the Storybook terminal output, fix the underlying issue, then retry the tool call.`;

const buildMultipleMatches = (records: StorybookInstanceRecordV1[]) =>
	`Multiple Storybook processes are registered at the same cwd. Stop all but one and retry.

Conflicting instances:
${records.map((r) => `- pid \`${r.pid}\` at \`${r.cwd}\` (${r.url})`).join('\n')}`;

export function getInterceptMarkdown(
	reason: InterceptReason,
	records?: StorybookInstanceRecordV1[],
): string {
	switch (reason) {
		case 'no-instance':
			return records && records.length > 0
				? buildNoInstanceWithCandidates(records)
				: NO_INSTANCE_EMPTY;
		case 'addon-missing':
			return ADDON_MISSING;
		case 'mcp-starting':
			return MCP_STARTING;
		case 'mcp-error':
			return MCP_ERROR;
		case 'multiple-matches':
			return buildMultipleMatches(records ?? []);
	}
}

export function intercept(reason: InterceptReason, records?: StorybookInstanceRecordV1[]) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, records) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
