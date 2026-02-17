import { createStorybookMcpHandler } from '@storybook/mcp';
import { serve } from 'srvx';
import fs from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const args = parseArgs({
	options: {
		port: {
			type: 'string',
			default: '13316',
		},
		manifestsDir: {
			type: 'string',
			default: './manifests',
		},
		format: {
			type: 'string',
			default: 'markdown',
		},
	},
});

const port = Number(args.values.port);
const manifestsDir = args.values.manifestsDir;
const format = args.values.format === 'xml' ? 'xml' : 'markdown';

const storybookMcpHandler = await createStorybookMcpHandler({
	format,
	manifestProvider: async (_request, path) => {
		const fileName = basename(path);

		if (manifestsDir.startsWith('http://') || manifestsDir.startsWith('https://')) {
			const response = await fetch(`${manifestsDir}/${fileName}`);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch manifest from ${manifestsDir}/${fileName}: ${response.status} ${response.statusText}`,
				);
			}
			return await response.text();
		}

		return await fs.readFile(resolve(manifestsDir, fileName), 'utf-8');
	},
});

serve({
	port,
	async fetch(request) {
		if (new URL(request.url).pathname !== '/mcp') {
			return new Response('Not found', { status: 404 });
		}

		return await storybookMcpHandler(request);
	},
});

console.log(
	`@storybook/mcp example server listening on http://localhost:${port}/mcp (format: ${format})`,
);
