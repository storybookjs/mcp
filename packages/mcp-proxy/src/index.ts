import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import pkgJson from '../package.json' with { type: 'json' };
import serverInstructions from './instructions.md';
import { registerProxiedTools } from './tools/index.ts';
import { DEFAULT_REGISTRY_DIR } from './utils/registry.ts';

export type {
	StorybookInstanceRecordV1,
	ProxyToolCallParams,
	ProxyToolCallResult,
	McpStatusV1,
} from './types/index.ts';

export type CreateProxyServerOptions = {
	registryDir?: string;
};

export async function createMcpProxyServer(options: CreateProxyServerOptions = {}) {
	const registryDir = options.registryDir ?? DEFAULT_REGISTRY_DIR;

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

	registerProxiedTools(server, registryDir);

	return server;
}
