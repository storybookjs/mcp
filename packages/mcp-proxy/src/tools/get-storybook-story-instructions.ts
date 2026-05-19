import type { McpServer } from 'tmcp';
import type { ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';

export function addGetStorybookStoryInstructionsTool(server: McpServer<any>, deps: ProxyDeps) {
	registerProxyTool(server, deps, {
		name: 'get-storybook-story-instructions',
		title: 'Storybook Story Development Instructions',
		description:
			'Get comprehensive instructions for writing, testing, and fixing Storybook stories (.stories.tsx, .stories.ts, .stories.jsx, .stories.js, .stories.svelte, .stories.vue files). CRITICAL: call this tool before creating, updating, or editing any story file. The instructions cover framework-specific imports, naming conventions, play functions, mocking, and test/a11y guidance.',
	});
}
