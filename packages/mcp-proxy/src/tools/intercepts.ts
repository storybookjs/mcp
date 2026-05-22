import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';
import type { WorkspacePackage } from '../utils/workspace.ts';

/**
 * Namespaced `_meta` key. MCP reserves unprefixed and `mcp.*` /
 * `modelcontextprotocol.*` / `anthropic.*` keys; everything else should live
 * under a reverse-DNS-like prefix to keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';

export type InterceptData = {
	/** Requested cwd from the tool call. Surfaced in the `no-instance` message. */
	requestedCwd?: string;
	/** Storybook instance records — running candidates for `no-instance`, conflicts for `multiple-matches`. */
	records?: StorybookInstanceRecordV1[];
	/** Workspace packages discovered for the supplied cwd. */
	workspaces?: WorkspacePackage[];
};

const ADDON_MISSING = `Storybook is running but does not expose an MCP server. The \`@storybook/addon-mcp\` addon is missing.

Install it:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`

Restart Storybook, then retry the tool call.`;

const MCP_STARTING = `Storybook is running but its MCP server is still starting up. Wait a moment and retry the tool call.`;

const MCP_ERROR = `Storybook is running but its MCP server reported an error. Inspect the Storybook terminal output, fix the underlying issue, then retry the tool call.`;

const INVALID_CWD = `\`cwd\` must be an absolute path matching the cwd from which \`storybook dev\` was started. Resolve the path on the client side (e.g. with \`path.resolve\`) and retry the tool call.`;

function buildNoInstance(data: InterceptData): string {
	const sections: string[] = [];
	const cwdLabel = data.requestedCwd ? `\`${data.requestedCwd}\`` : 'this cwd';

	sections.push(
		`No Storybook is running at ${cwdLabel}. To fix this, either start \`storybook dev\` from the project you want, or retry with a cwd listed below.`,
	);

	if (data.records && data.records.length > 0) {
		sections.push(
			['Running Storybooks:', ...data.records.map((r) => `- \`${r.cwd}\` (${r.url})`)].join('\n'),
		);
	}

	if (data.workspaces && data.workspaces.length > 0) {
		const lines = data.workspaces.map((pkg) => {
			const name = pkg.name ?? '(unnamed)';
			const sb = pkg.hasStorybook ? '✓' : '✗';
			const addon = pkg.hasAddonMcp
				? '✓'
				: pkg.hasStorybook
					? '✗ — run `npx storybook add @storybook/addon-mcp`'
					: '✗';
			return `- \`${pkg.packagePath}\` (${name}) — Storybook: ${sb}, @storybook/addon-mcp: ${addon}`;
		});
		const noneHaveStorybook = data.workspaces.every((p) => !p.hasStorybook);
		const intro = noneHaveStorybook
			? 'No package in this monorepo has Storybook installed. Ask the user which package they want Storybook in, then run `npx storybook init` from that package directory:'
			: 'Workspace packages in this monorepo. If the user has not indicated which package to target, ask them before starting `storybook dev` or installing anything:';
		sections.push([intro, ...lines].join('\n'));
	}

	return sections.join('\n\n');
}

function buildMultipleMatches(records: StorybookInstanceRecordV1[]): string {
	return `Multiple Storybook processes are registered at the same cwd. Stop all but one and retry.

Conflicting instances:
${records.map((r) => `- pid \`${r.pid}\` at \`${r.cwd}\` (${r.url})`).join('\n')}`;
}

export function getInterceptMarkdown(reason: InterceptReason, data: InterceptData = {}): string {
	switch (reason) {
		case 'no-instance':
			return buildNoInstance(data);
		case 'multiple-matches':
			return buildMultipleMatches(data.records ?? []);
		case 'addon-missing':
			return ADDON_MISSING;
		case 'mcp-starting':
			return MCP_STARTING;
		case 'mcp-error':
			return MCP_ERROR;
		case 'invalid-cwd':
			return INVALID_CWD;
	}
}

export function intercept(reason: InterceptReason, data: InterceptData = {}) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, data) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}
