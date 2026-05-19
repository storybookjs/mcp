import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import pkgJson from '../package.json' with { type: 'json' };
import serverInstructions from './instructions.md';
import { addListAllDocumentationTool } from './tools/list-all-documentation.ts';
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
	// TODO: register the remaining 6 tools (get-documentation, get-documentation-for-story,
	// preview-stories, get-changed-stories, get-storybook-story-instructions, run-story-tests)
	// once the first end-to-end flow is verified.

	return server;
}
