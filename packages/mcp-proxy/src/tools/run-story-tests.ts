import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { ProxyContext, ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';
import { StoryInputArray } from './shared.ts';

const Input = v.object({
	stories: v.optional(
		v.pipe(
			StoryInputArray,
			v.description(
				'Stories to test for focused feedback. Omit to run all available stories. Prefer focused runs while iterating for faster feedback; only omit to run the full suite for comprehensive verification.',
			),
		),
	),
	a11y: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'Whether to run accessibility tests. Defaults to true. Disable if you only need component test results.',
			),
		),
		true,
	),
});

export function addRunStoryTestsTool(server: McpServer<any, ProxyContext>, deps: ProxyDeps) {
	registerProxyTool(server, deps, {
		name: 'run-story-tests',
		title: 'Storybook Tests',
		description:
			'Run story tests. Provide stories for focused runs (faster while iterating), or omit to run all tests. Use this continuously to monitor test results as you work on components and stories. Results include passing/failing status, and accessibility violation reports when the running Storybook has addon-a11y enabled.',
		schema: Input,
	});
}
