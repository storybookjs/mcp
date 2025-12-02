import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import { errorToMCPContent } from '../utils/errors.ts';
import type { AddonContext } from '../types.ts';
import { StoryInput } from '../types.ts';
import { createUIResource } from '@mcp-ui/server';

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
				console.log(input);
				const uiResource = createUIResource({
					uri: 'ui://greeting',
					content: {
						type: 'externalUrl',
						iframeUrl: 'https://example.com',
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
