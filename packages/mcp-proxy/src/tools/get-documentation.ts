import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { ProxyContext, ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';
import { StorybookIdField } from './shared.ts';

const Input = v.object({
	id: v.pipe(v.string(), v.description('The component or docs entry ID (e.g., "button").')),
	...StorybookIdField,
});

export function addGetDocumentationTool(server: McpServer<any, ProxyContext>, deps: ProxyDeps) {
	registerProxyTool(server, deps, {
		name: 'get-documentation',
		title: 'Get Documentation',
		description:
			'Get documentation for a UI component or docs entry. Returns the first stories (including story IDs) with code snippets, plus TypeScript prop definitions. Call this before using a component to avoid hallucinating prop names, types, or valid combinations.',
		schema: Input,
	});
}
