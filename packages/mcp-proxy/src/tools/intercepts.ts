import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';
import { MIN_SUPPORTED_STORYBOOK_VERSION } from '../utils/resolve-instance.ts';

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

const INVALID_CWD = `\`cwd\` must be an absolute path matching the cwd from which \`storybook dev\` was started. Resolve the path on the client side (e.g. with \`path.resolve\`) and retry the tool call.`;

const buildStorybookNeedsUpgrade = (records: StorybookInstanceRecordV1[]) =>
	`The running Storybook is too old to support \`@storybook/addon-mcp\`. Ask the user to upgrade Storybook first; the MCP tools cannot proxy to this instance until they do.

- Detected Storybook version: \`${records[0]?.storybookVersion ?? 'unknown'}\`
- Minimum supported: \`${MIN_SUPPORTED_STORYBOOK_VERSION}\` (or any 10.x)

If the \`storybook:storybook-upgrade\` skill is available, invoke it. Otherwise upgrade manually:
\`\`\`
npx storybook upgrade
\`\`\`

Then install the addon and restart \`storybook dev\`:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\``;

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
		case 'storybook-needs-upgrade':
			return buildStorybookNeedsUpgrade(records ?? []);
	}
}

export function intercept(reason: InterceptReason, records?: StorybookInstanceRecordV1[]) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, records) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
