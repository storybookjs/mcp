import * as path from 'node:path';
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { clearStorybookVersionCache } from '../utils/version-check.ts';
import { intercept } from './intercepts.ts';
import type { ProxyToolCallResult } from '../types/index.ts';

export function registerClearVersionCacheTool(server: McpServer<any>) {
	server.tool(
		{
			name: 'clear-storybook-version-cache',
			title: 'Clear Storybook Version Cache',
			description:
				'Clear the in-memory cached Storybook version detection for a project. Call this after upgrading Storybook (e.g. via the `storybook-upgrade` skill) so the proxy re-reads `storybook/package.json` on the next tool call instead of returning the stale `too-old` result.',
			schema: v.object({
				cwd: v.pipe(
					v.string(),
					v.description(
						'Absolute path of the Storybook project whose cached version detection should be cleared. Must exactly match the cwd used in previous tool calls.',
					),
				),
			}),
		},
		async ({ cwd }: { cwd: string }): Promise<ProxyToolCallResult> => {
			if (!path.isAbsolute(cwd)) {
				return intercept('invalid-cwd');
			}
			clearStorybookVersionCache(cwd);
			return {
				content: [
					{
						type: 'text',
						text: `Cleared cached Storybook version detection for \`${cwd}\`. The next tool call will re-read \`storybook/package.json\` from disk.`,
					},
				],
			};
		},
	);
}
