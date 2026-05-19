import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import pkgJson from '../package.json' with { type: 'json' };
import serverInstructions from './instructions.md';
import { registerProxiedTools } from './tools/index.ts';
import { readRegistry, DEFAULT_REGISTRY_DIR } from './registry.ts';
import { proxyToolCall as defaultProxyToolCall } from './proxy-client.ts';
import type { ProxyDeps } from './types.ts';

export type {
	ProxyDeps,
	StorybookInstanceRecord,
	ProxyToolCallParams,
	ProxyToolCallResult,
	McpStatus,
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
	);

	registerProxiedTools(server, deps);

	return server;
}
