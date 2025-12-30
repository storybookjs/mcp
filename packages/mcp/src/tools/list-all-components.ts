import type { McpServer } from 'tmcp';
import type { StorybookContext } from '../types.ts';
import { getManifests, errorToMCPContent } from '../utils/get-manifest.ts';
import { formatManifestsToLists as formatManifestsToLists } from '../utils/format-manifest.ts';

export const LIST_TOOL_NAME = 'list-all-components';

export async function addListAllComponentsTool(
	server: McpServer<any, StorybookContext>,
	enabled?: Parameters<McpServer<any, StorybookContext>['tool']>[0]['enabled'],
) {
	server.tool(
		{
			name: LIST_TOOL_NAME,
			title: 'List All Components',
			description:
				'List all available UI components from the component library',
			enabled,
		},
		async () => {
			try {
				const manifests = await getManifests(
					server.ctx.custom?.request,
					server.ctx.custom?.manifestProvider,
				);

				const format = server.ctx.custom?.format ?? 'markdown';
				const lists = formatManifestsToLists(manifests, format);

				await server.ctx.custom?.onListAllComponents?.({
					context: server.ctx.custom,
					manifests,
				});

				return {
					content: [
						{
							type: 'text',
							text: lists,
						},
					],
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}
