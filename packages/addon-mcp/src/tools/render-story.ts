import { createUIResource } from '@mcp-ui/server';
import path from 'node:path';
import { storyNameFromExport } from 'storybook/internal/csf';
import { logger } from 'storybook/internal/node-logger';
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { AddonContext } from '../types.ts';
import { StoryInput } from '../types.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import { fetchStoryIndex } from '../utils/fetch-story-index.ts';
import { renderStoryHtml } from './render-story.html.ts';

export const RENDER_STORY_NAME = 'render-story';

const RenderStoryInput = v.object({
	story: StoryInput,
});

type RenderStoryInput = v.InferOutput<typeof RenderStoryInput>;
export async function addRenderStoryTool(server: McpServer<any, AddonContext>) {
	server.tool(
		{
			name: RENDER_STORY_NAME,
			title: 'Render a story',
			description: `Render a story in the UI.`,
			schema: RenderStoryInput,
			enabled: () => server.ctx.custom?.toolsets?.dev ?? true,
		},
		async (input: RenderStoryInput) => {
			try {
				const { origin } = server.ctx.custom ?? {};

				if (!origin) {
					throw new Error('Origin is required in addon context');
				}

				const index = await fetchStoryIndex(origin);
				const entriesList = Object.values(index.entries);

				const { exportName, explicitStoryName, absoluteStoryPath } =
					input.story;
				const relativePath = `./${path.relative(process.cwd(), absoluteStoryPath)}`;

				logger.debug('Searching for:');
				logger.debug({
					exportName,
					explicitStoryName,
					absoluteStoryPath,
					relativePath,
				});

				const foundStoryId = entriesList.find(
					(entry) =>
						entry.importPath === relativePath &&
						[explicitStoryName, storyNameFromExport(exportName)].includes(
							entry.name,
						),
				)?.id;

				if (!foundStoryId) {
					logger.debug('No story found');

					throw new Error(
						`No story found for export name "${exportName}" with absolute file path "${absoluteStoryPath}"`,
					);
				}
				logger.debug('Found story ID:', foundStoryId);

				const uiResource = createUIResource({
					uri: 'ui://greeting',
					content: {
						type: 'rawHtml',
						htmlString: renderStoryHtml.replace('__ID__', foundStoryId),
					},
					encoding: 'text',
				});

				return {
					content: [uiResource as any],
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}
