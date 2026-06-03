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
				'Manually clear the in-memory cached Storybook version detection for a project. Rarely needed: the proxy already re-reads `storybook/package.json` from disk on every call for `too-old`/`not-installed` projects (only an `ok` result is cached), so an upgrade or fresh install is picked up automatically. Use this as an escape hatch if a tool call still reports a stale version after an in-session change.',
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
