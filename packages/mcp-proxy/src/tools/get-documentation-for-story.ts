import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { ProxyContext, ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';
import { StorybookIdField } from './shared.ts';

const Input = v.object({
	componentId: v.string(),
	storyName: v.string(),
	...StorybookIdField,
});

export function addGetDocumentationForStoryTool(
	server: McpServer<any, ProxyContext>,
	deps: ProxyDeps,
) {
	registerProxyTool(server, deps, {
		name: 'get-documentation-for-story',
		title: 'Get Documentation for Story',
		description:
			'Get detailed documentation for a specific story variant of a UI component. Use this when you need to see more usage examples of a component, via the stories written for it.',
		schema: Input,
	});
}
