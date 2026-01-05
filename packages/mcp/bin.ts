/**
 * This is a way to start the @storybook/mcp server as a stdio MCP server, which is sometimes easier for testing.
 * You can run it like this:
 *   node bin.ts --componentManifestPath ./path/to/components.json --format markdown
 *
 * Optionally, you can also provide a docs manifest:
 *   node bin.ts --componentManifestPath ./path/to/components.json --docsManifestPath ./path/to/docs.json
 *
 * Or when configuring it as an MCP server:
 * {
 *   "storybook-mcp": {
 *     "type": "stdio",
 *     "command": "node",
 *     "args": ["bin.ts", "--componentManifestPath", "./path/to/components.json", "--format", "markdown"]
 *   }
 * }
 */
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { StdioTransport } from '@tmcp/transport-stdio';
import pkgJson from './package.json' with { type: 'json' };
import { addListAllDocumentationTool } from './src/tools/list-all-documentation.ts';
import { addGetDocumentationTool } from './src/tools/get-documentation.ts';
import type { StorybookContext, OutputFormat } from './src/types.ts';
import { parseArgs } from 'node:util';
import * as fs from 'node:fs/promises';

const adapter = new ValibotJsonSchemaAdapter();
const server = new McpServer(
	{
		name: pkgJson.name,
		version: pkgJson.version,
		description: pkgJson.description,
	},
	{
		adapter,
		capabilities: {
			tools: { listChanged: true },
		},
	},
).withContext<StorybookContext>();

await addListAllDocumentationTool(server);
await addGetDocumentationTool(server);

const transport = new StdioTransport(server);
const args = parseArgs({
	options: {
		componentManifestPath: {
			type: 'string',
			default: './fixtures/full-manifest.fixture.json',
		},
		docsManifestPath: {
			type: 'string',
		},
		format: {
			type: 'string',
			default: 'markdown',
		},
	},
});

const format = args.values.format as OutputFormat;

async function readManifest(manifestPath: string): Promise<string> {
	if (
		manifestPath.startsWith('http://') ||
		manifestPath.startsWith('https://')
	) {
		const res = await fetch(manifestPath);
		return await res.text();
	}
	return await fs.readFile(manifestPath, 'utf-8');
}

transport.listen({
	format,
	manifestProvider: async (_request, path) => {
		const { componentManifestPath, docsManifestPath } = args.values;

		// Determine which manifest to load based on the requested path
		if (path.includes('docs')) {
			if (!docsManifestPath) {
				throw new Error(
					'Docs manifest requested but --docsManifestPath was not provided',
				);
			}
			return await readManifest(docsManifestPath);
		}

		// Default to component manifest
		return await readManifest(componentManifestPath);
	},
});
