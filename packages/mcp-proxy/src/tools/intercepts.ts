import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';
import { STORYBOOK_MIN_VERSION } from '../utils/version-check.ts';

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

const buildStorybookTooOld = (version: string) =>
	`The Storybook installed at this cwd is version \`${version}\`, but this plugin requires \`${STORYBOOK_MIN_VERSION}\` or newer.

Ask the user whether they want to upgrade Storybook. If they agree, invoke the \`storybook-upgrade\` skill to perform the upgrade, then run:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`
to install the MCP addon. Restart Storybook, then retry the tool call.`;

const ADDON_MISSING = `Storybook is running but does not expose an MCP server. The \`@storybook/addon-mcp\` addon is missing.

Install it:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`

Restart Storybook, then retry the tool call.`;

const MCP_STARTING = `Storybook is running but its MCP server is still starting up. Wait a moment and retry the tool call.`;

const MCP_ERROR = `Storybook is running but its MCP server reported an error. Inspect the Storybook terminal output, fix the underlying issue, then retry the tool call.`;

const INVALID_CWD = `\`cwd\` must be an absolute path matching the cwd from which \`storybook dev\` was started. Resolve the path on the client side (e.g. with \`path.resolve\`) and retry the tool call.`;

export type InterceptExtras = {
	records?: StorybookInstanceRecordV1[];
	version?: string;
};

export function getInterceptMarkdown(
	reason: InterceptReason,
	extras: InterceptExtras = {},
): string {
	const { records, version } = extras;
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
		case 'invalid-cwd':
			return INVALID_CWD;
		case 'storybook-too-old':
			return buildStorybookTooOld(version ?? 'unknown');
	}
}

export function intercept(reason: InterceptReason, extras: InterceptExtras = {}) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, extras) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
