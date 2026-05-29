import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';
import { STORYBOOK_MIN_VERSION } from '../utils/version-check.ts';

type ClientInfoLike = {
	name?: string;
	version?: string;
	title?: string;
	websiteUrl?: string;
};

export type InterceptContext = {
	clientInfo?: ClientInfoLike;
};

/**
 * Namespaced `_meta` key. MCP reserves unprefixed and `mcp.*` /
 * `modelcontextprotocol.*` / `anthropic.*` keys; everything else should live
 * under a reverse-DNS-like prefix to keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';

const CLAUDE_LAUNCH_REPAIR = `The story file you wrote cannot be verified (no play tests, no preview, no a11y)
until Storybook is started.
(Claude Code only:) STOP. Recover now, without asking the user:
	1. Invoke skill: storybook:storybook-setup-claude-launch (creates/repairs .claude/launch.json AND starts Storybook)
	2. Retry this MCP tool call.
	Do NOT fall back to writing stories from existing patterns —
	unverified stories are not a deliverable. If step 1 reports an
	error, surface it to the user and stop.`;

const NO_INSTANCE_EMPTY = `Storybook is not running at this cwd. Start Storybook from the exact Storybook cwd and retry the tool call.`;

const buildNoInstanceWithCandidates = (records: StorybookInstanceRecordV1[]) =>
	`No Storybook is running at this cwd. Either start Storybook from the project's cwd, or retry with one of the running cwds below.

Running Storybooks:
${records.map((r) => `- \`${r.cwd}\` (${r.url})`).join('\n')}`;

const buildStorybookTooOld = (version: string) =>
	`The Storybook installed at this cwd is version \`${version}\`, but this plugin requires \`${STORYBOOK_MIN_VERSION}\` or newer.

Ask the user whether they want to upgrade Storybook. If they agree, invoke the \`storybook-upgrade\` skill to perform the upgrade, then run:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`
to install the MCP addon. After the upgrade, call the \`clear-storybook-version-cache\` tool with the same \`cwd\` so the proxy re-detects the new version. Restart Storybook, then retry the tool call.`;

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

export type InterceptExtras = {
	records?: StorybookInstanceRecordV1[];
	version?: string;
};

export function isClaudeClient(clientInfo?: ClientInfoLike): boolean {
	const clientText = [clientInfo?.name, clientInfo?.title, clientInfo?.websiteUrl]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	return /(^|[^a-z])claude([^a-z]|$)/.test(clientText);
}

const appendClientSpecificRepair = (message: string, context?: InterceptContext) =>
	isClaudeClient(context?.clientInfo) ? `${message}\n\n${CLAUDE_LAUNCH_REPAIR}` : message;

export function getInterceptMarkdown(
	reason: InterceptReason,
	extras: InterceptExtras = {},
	context?: InterceptContext,
): string {
	const { records, version } = extras;
	switch (reason) {
		case 'no-instance':
			return appendClientSpecificRepair(
				records && records.length > 0 ? buildNoInstanceWithCandidates(records) : NO_INSTANCE_EMPTY,
				context,
			);
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
		case 'storybook-too-old':
			return buildStorybookTooOld(version ?? 'unknown');
	}
}

export function intercept(
	reason: InterceptReason,
	extras: InterceptExtras = {},
	context?: InterceptContext,
) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, extras, context) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
