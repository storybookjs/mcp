import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { readRegistry } from '../utils/registry.ts';
import type { ProxyToolCallResult } from '../types/index.ts';

export function registerListRunningStorybooksTool(server: McpServer<any>, registryDir: string) {
	server.tool(
		{
			name: 'list-running-storybooks',
			title: 'List Running Storybooks',
			description:
				'List every Storybook dev server currently running on this machine, with its working directory (cwd), URL, port, and version. Use the reported cwd as the `cwd` argument for the other Storybook tools — each call must target one of these exact cwds.',
			schema: v.object({}),
		},
		async (): Promise<ProxyToolCallResult> => {
			const records = await readRegistry(registryDir);

			if (records.length === 0) {
				return {
					content: [
						{
							type: 'text',
							text: 'No Storybook dev servers are currently running. Start one with `storybook dev` from your project directory.',
						},
					],
				};
			}

			const blocks = records.map((r) => {
				const subLines = [
					`  - url: ${r.url}`,
					`  - port: ${r.port}`,
					`  - storybook version: ${r.storybookVersion ?? 'unknown'}`,
					`  - mcp status: ${r.mcp.status}`,
				];
				return `- \`${r.cwd}\`\n${subLines.join('\n')}`;
			});

			const text = `Running Storybooks (${records.length}):\n${blocks.join('\n')}`;

			return {
				content: [{ type: 'text', text }],
			};
		},
	);
}
