import * as v from 'valibot';
import type { McpServer } from 'tmcp';
import { registerProxyTool } from './proxy-tool.ts';
import { StoryInputArray, StorybookIdField } from './shared.ts';

export function registerProxiedTools(server: McpServer<any>, registryDir: string) {
	registerProxyTool(server, registryDir, {
		name: 'list-all-documentation',
		title: 'List All Documentation',
		description: 'List all available UI components and documentation entries from Storybook.',
		schema: v.object({
			withStoryIds: v.optional(
				v.pipe(
					v.boolean(),
					v.description(
						'When true, includes story sub-bullets under each component with story name and story ID.',
					),
				),
				false,
			),
		}),
	});

	registerProxyTool(server, registryDir, {
		name: 'get-documentation',
		title: 'Get Documentation',
		description:
			'Get documentation for a UI component or docs entry. Returns the first stories (including story IDs) with code snippets, plus TypeScript prop definitions. Call this before using a component to avoid hallucinating prop names, types, or valid combinations.',
		schema: v.object({
			id: v.pipe(v.string(), v.description('The component or docs entry ID (e.g., "button").')),
			...StorybookIdField,
		}),
	});

	registerProxyTool(server, registryDir, {
		name: 'get-documentation-for-story',
		title: 'Get Documentation for Story',
		description:
			'Get detailed documentation for a specific story variant of a UI component. Use this when you need to see more usage examples of a component, via the stories written for it.',
		schema: v.object({
			componentId: v.string(),
			storyName: v.string(),
			...StorybookIdField,
		}),
	});

	registerProxyTool(server, registryDir, {
		name: 'preview-stories',
		title: 'Get story preview URLs',
		description:
			'Use this tool to get one or more Storybook preview URLs. Always include each returned preview URL in your final user-facing response so users can open them directly.',
		schema: v.object({
			stories: v.pipe(
				StoryInputArray,
				v.description(
					'Stories to preview. Prefer { storyId } when you do not already have story file context, since this avoids filesystem discovery. Use { absoluteStoryPath + exportName } only when you are already working in a specific .stories.* file.',
				),
			),
		}),
	});

	registerProxyTool(server, registryDir, {
		name: 'get-changed-stories',
		title: 'Get changed stories metadata',
		description:
			'Get Storybook stories marked as new, modified, or related. Returns story metadata only (no URLs).',
	});

	registerProxyTool(server, registryDir, {
		name: 'get-storybook-story-instructions',
		title: 'Storybook Story Development Instructions',
		description:
			'Get comprehensive instructions for writing, testing, and fixing Storybook stories (.stories.tsx, .stories.ts, .stories.jsx, .stories.js, .stories.svelte, .stories.vue files). CRITICAL: call this tool before creating, updating, or editing any story file. The instructions cover framework-specific imports, naming conventions, play functions, mocking, and test/a11y guidance.',
	});

	registerProxyTool(server, registryDir, {
		name: 'run-story-tests',
		title: 'Storybook Tests',
		description:
			'Run story tests. Provide stories for focused runs (faster while iterating), or omit to run all tests. Use this continuously to monitor test results as you work on components and stories. Results include passing/failing status, and accessibility violation reports when the running Storybook has addon-a11y enabled.',
		schema: v.object({
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
		}),
	});
}
