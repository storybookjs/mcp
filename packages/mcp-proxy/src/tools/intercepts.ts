import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';

/**
 * Namespaced `_meta` key. MCP reserves unprefixed and `mcp.*` /
 * `modelcontextprotocol.*` / `anthropic.*` keys; everything else should live
 * under a reverse-DNS-like prefix to keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';

const CLAUDE_LAUNCH_REPAIR = `If you are using Claude Code with the Storybook plugin, do not start Storybook as an ad hoc Bash/background task. Use \`/storybook-setup-claude-launch\` to create or repair \`.claude/launch.json\`, then start Storybook through the Claude launcher from the exact same cwd and retry the tool call.`;

const NO_INSTANCE_EMPTY = `Storybook is not running at this cwd. Start Storybook from the exact Storybook cwd and retry the tool call.

${CLAUDE_LAUNCH_REPAIR}`;

const buildNoInstanceWithCandidates = (records: StorybookInstanceRecordV1[]) =>
	`No Storybook is running at this cwd. Either start Storybook from the project's cwd, or retry with one of the running cwds below.

Running Storybooks:
${records.map((r) => `- \`${r.cwd}\` (${r.url})`).join('\n')}

${CLAUDE_LAUNCH_REPAIR}`;

const ADDON_MISSING = `Storybook is running but does not expose an MCP server. The \`@storybook/addon-mcp\` addon is missing.

Install it:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`

Restart Storybook, then retry the tool call.`;

const MCP_STARTING = `Storybook is running but its MCP server is still starting up. Wait a moment and retry the tool call.`;

const MCP_ERROR = `Storybook is running but its MCP server reported an error. Inspect the Storybook terminal output, fix the underlying issue, then retry the tool call.`;

const INVALID_CWD = `\`cwd\` must be an absolute path matching the cwd from which \`storybook dev\` was started. Resolve the path on the client side (e.g. with \`path.resolve\`) and retry the tool call.`;

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
		case 'invalid-cwd':
			return INVALID_CWD;
	}
}

export function intercept(reason: InterceptReason, records?: StorybookInstanceRecordV1[]) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, records) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
