import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import pkgJson from '../package.json' with { type: 'json' };
import serverInstructions from './instructions.md';
import { addListAllDocumentationTool } from './tools/list-all-documentation.ts';
import { addGetDocumentationTool } from './tools/get-documentation.ts';
import { addGetDocumentationForStoryTool } from './tools/get-documentation-for-story.ts';
import { addPreviewStoriesTool } from './tools/preview-stories.ts';
import { addGetChangedStoriesTool } from './tools/get-changed-stories.ts';
import { addGetStorybookStoryInstructionsTool } from './tools/get-storybook-story-instructions.ts';
import { addRunStoryTestsTool } from './tools/run-story-tests.ts';
import { readRegistry, DEFAULT_REGISTRY_DIR } from './registry.ts';
import { proxyToolCall as defaultProxyToolCall } from './proxy-client.ts';
import type { ProxyContext, ProxyDeps } from './types.ts';

export type {
	ProxyContext,
	ProxyDeps,
	StorybookInstanceRecord,
	ProxyToolCallParams,
	ProxyToolCallResult,
} from './types.ts';

export type CreateProxyServerOptions = {
	registryDir?: string;
	deps?: Partial<ProxyDeps>;
};

export async function createMcpProxyServer(options: CreateProxyServerOptions = {}) {
	const registryDir = options.registryDir ?? DEFAULT_REGISTRY_DIR;
	const deps: ProxyDeps = {
		readRegistry: options.deps?.readRegistry ?? (() => readRegistry(registryDir)),
		proxyToolCall: options.deps?.proxyToolCall ?? defaultProxyToolCall,
		cwd: options.deps?.cwd ?? (() => process.cwd()),
	};

	const server = new McpServer(
		{
			name: pkgJson.name,
			version: pkgJson.version,
			description: pkgJson.description,
		},
		{
			adapter: new ValibotJsonSchemaAdapter(),
			instructions: serverInstructions,
			capabilities: {
				tools: { listChanged: true },
			},
		},
	).withContext<ProxyContext>();

	addListAllDocumentationTool(server, deps);
	addGetDocumentationTool(server, deps);
	addGetDocumentationForStoryTool(server, deps);
	addPreviewStoriesTool(server, deps);
	addGetChangedStoriesTool(server, deps);
	addGetStorybookStoryInstructionsTool(server, deps);
	addRunStoryTestsTool(server, deps);

	return server;
}
