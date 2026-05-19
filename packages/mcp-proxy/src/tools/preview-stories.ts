import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';
import { StoryInputArray } from './shared.ts';

const Input = v.object({
	stories: v.pipe(
		StoryInputArray,
		v.description(
			'Stories to preview. Prefer { storyId } when you do not already have story file context, since this avoids filesystem discovery. Use { absoluteStoryPath + exportName } only when you are already working in a specific .stories.* file.',
		),
	),
});

export function addPreviewStoriesTool(server: McpServer<any>, deps: ProxyDeps) {
	registerProxyTool(server, deps, {
		name: 'preview-stories',
		title: 'Get story preview URLs',
		description:
			'Use this tool to get one or more Storybook preview URLs. Always include each returned preview URL in your final user-facing response so users can open them directly.',
		schema: Input,
	});
}
