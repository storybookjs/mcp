import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';
import { STORYBOOK_MIN_VERSION } from '../utils/version-check.ts';

/**
 * Namespaced `_meta` key. MCP reserves unprefixed and `mcp.*` /
 * `modelcontextprotocol.*` / `anthropic.*` keys; everything else should live
 * under a reverse-DNS-like prefix to keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';

const NO_INSTANCE_EMPTY = `Storybook is not running at this cwd. Start Storybook from the exact Storybook cwd in the preview and retry the tool call.`;

const buildNoInstanceWithCandidates = (records: StorybookInstanceRecordV1[]) =>
	`No Storybook is running at this cwd. Either start Storybook from the project's cwd, or retry with one of the running cwds below.

Running Storybooks:
${records.map((r) => `- \`${r.cwd}\` (${r.url})`).join('\n')}`;

const buildPortMismatch = (port: number | undefined, records: StorybookInstanceRecordV1[]) =>
	`Storybook is running at this cwd, but not on port \`${port ?? 'unknown'}\`. Retry with one of the running ports below, or omit \`port\` to route by cwd alone.

Running Storybooks at this cwd:
${records.map((r) => `- port \`${r.port}\` (${r.url}, mcp: \`${r.mcp.status}\`)`).join('\n')}`;

const buildStorybookTooOld = (version: string) =>
	`The Storybook installed at this cwd is version \`${version}\`, but this plugin requires \`${STORYBOOK_MIN_VERSION}\` or newer.

Ask the user whether they want to upgrade Storybook. If they agree, invoke the \`storybook-upgrade\` skill to perform the upgrade, then run:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`
to install the MCP addon. After the upgrade, call the \`clear-storybook-version-cache\` tool with the same \`cwd\` so the proxy re-detects the new version. Restart Storybook, then retry the tool call.`;

const STORYBOOK_NOT_INSTALLED = `No Storybook is running at this cwd, and Storybook does not appear to be installed here (\`storybook\` could not be resolved from this project).

Ask the user whether they want to add Storybook. If they agree, invoke the \`storybook-init\` skill to set it up, then install the MCP addon:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`
Start Storybook, then retry the tool call.

If you believe Storybook is in fact installed (e.g. a monorepo where \`storybook\` resolves from a different location), start \`storybook dev\` from this exact cwd and retry — a running instance is always proxied regardless of this check.`;

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
	port?: number;
};

export function getInterceptMarkdown(
	reason: InterceptReason,
	extras: InterceptExtras = {},
): string {
	const { records, version, port } = extras;
	switch (reason) {
		case 'no-instance':
			return records && records.length > 0
				? buildNoInstanceWithCandidates(records)
				: NO_INSTANCE_EMPTY;
		case 'port-mismatch':
			return buildPortMismatch(port, records ?? []);
		case 'storybook-not-installed':
			return STORYBOOK_NOT_INSTALLED;
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
