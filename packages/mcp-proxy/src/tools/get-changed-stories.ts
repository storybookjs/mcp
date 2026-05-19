import type { McpServer } from 'tmcp';
import type { ProxyContext, ProxyDeps } from '../types.ts';
import { registerProxyTool } from './proxy-tool.ts';

export function addGetChangedStoriesTool(server: McpServer<any, ProxyContext>, deps: ProxyDeps) {
	registerProxyTool(server, deps, {
		name: 'get-changed-stories',
		title: 'Get changed stories metadata',
		description:
			'Get Storybook stories marked as new, modified, or related. Returns story metadata only (no URLs).',
	});
}
