import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { ProxyContext, ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';

/**
 * NOTE: The schema is duplicated from `@storybook/mcp` so the proxy can declare
 * the full tool surface without a runtime dependency on a running Storybook.
 * Keep this in lockstep with `packages/mcp/src/tools/list-all-documentation.ts`
 * until a shared schemas subpath export exists.
 */
const ListAllDocumentationInput = v.object({
	withStoryIds: v.optional(
		v.pipe(
			v.boolean(),
			v.description(
				'When true, includes story sub-bullets under each component with story name and story ID.',
			),
		),
		false,
	),
});

export function addListAllDocumentationTool(
	server: McpServer<any, ProxyContext>,
	deps: ProxyDeps,
) {
	registerProxyTool(server, deps, {
		name: 'list-all-documentation',
		title: 'List All Documentation',
		description: 'List all available UI components and documentation entries from Storybook.',
		schema: ListAllDocumentationInput,
	});
}
