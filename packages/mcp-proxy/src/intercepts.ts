import type { InterceptReason, StorybookInstanceRecord } from './types.ts';

/**
 * Namespaced `_meta` keys. MCP reserves unprefixed and `mcp.*` / `modelcontextprotocol.*`
 * / `anthropic.*` keys; everything else should live under a reverse-DNS-like prefix to
 * keep the wire format forward-compatible.
 */
export const META_INTERCEPT_REASON = 'storybook.dev/interceptReason';
export const META_FALLBACK_INSTANCE = 'storybook.dev/fallbackInstance';

const NOT_RUNNING = `Storybook is not running for this project.

Start Storybook before retrying:
- If a Storybook launch setup skill is available in this environment, run it.
- Otherwise run \`storybook dev\` in the project root and open the resulting URL.

Once Storybook is running, retry the tool call.`;

const NO_LAUNCH_CONFIG = `No Storybook launch configuration was found for this project.

If a Storybook launch setup skill is available in this environment, run it to wire up the preview. Otherwise run \`storybook dev\` directly in the project root.

Once Storybook is running, retry the tool call.`;

const ADDON_MISSING = `Storybook is running but does not expose an MCP server. The \`@storybook/addon-mcp\` addon is missing.

Install it:
\`\`\`
npx storybook add @storybook/addon-mcp
\`\`\`

Restart Storybook, then retry the tool call.`;

const STORYBOOK_OUTDATED = `The running Storybook is too old to expose an MCP server. Upgrade Storybook to a version that supports \`@storybook/addon-mcp\`.

Upgrade it:
\`\`\`
npx storybook@latest upgrade
\`\`\`

Restart Storybook, then retry the tool call.`;

const MCP_STARTING = `Storybook is running but its MCP server is still starting up. Wait a moment and retry the tool call.`;

const buildMultipleMatches = (records: StorybookInstanceRecord[]) =>
	`Multiple Storybook instances match this project. Ask the user which one to use, then pass its project root as \`cwd\` on the next call.

Candidates:
${records.map((r) => `- \`${r.cwd}\` (${r.url})`).join('\n')}`;

const TEMPLATES: Record<Exclude<InterceptReason, 'multiple-matches'>, string> = {
	'no-instance': NOT_RUNNING,
	'no-launch-config': NO_LAUNCH_CONFIG,
	'addon-missing': ADDON_MISSING,
	'storybook-outdated': STORYBOOK_OUTDATED,
	'mcp-starting': MCP_STARTING,
};

export function getInterceptMarkdown(
	reason: InterceptReason,
	records?: StorybookInstanceRecord[],
): string {
	if (reason === 'multiple-matches') {
		return buildMultipleMatches(records ?? []);
	}
	return TEMPLATES[reason];
}

export function intercept(reason: InterceptReason, records?: StorybookInstanceRecord[]) {
	return {
		content: [{ type: 'text' as const, text: getInterceptMarkdown(reason, records) }],
		isError: true,
		_meta: { [META_INTERCEPT_REASON]: reason },
	};
}

export function fallbackPreamble(record: StorybookInstanceRecord, requested: string): string {
	return `Note: no Storybook instance matched \`${requested}\`. Falling back to the only running Storybook at \`${record.cwd}\` (${record.url}). Pass \`cwd\` explicitly to target a different project.`;
}
