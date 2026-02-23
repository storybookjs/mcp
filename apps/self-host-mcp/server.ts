import { createStorybookMcpHandler } from '@storybook/mcp';
import fs from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export function createMcpHandler(manifestsPath: string) {
	return createStorybookMcpHandler({
		manifestProvider: async (_request: Request | undefined, path: string) => {
			const fileName = basename(path);

			if (manifestsPath.startsWith('http://') || manifestsPath.startsWith('https://')) {
				const response = await fetch(`${manifestsPath}/${fileName}`);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch manifest from ${manifestsPath}/${fileName}: ${response.status} ${response.statusText}`,
					);
				}
				return await response.text();
			}

			return await fs.readFile(resolve(manifestsPath, fileName), 'utf-8');
		},
	});
}

// when running node ./server.ts
if (import.meta.main) {
	const [{ serve }, { parseArgs }] = await Promise.all([import('srvx'), import('node:util')]);

	const args = parseArgs({
		options: {
			port: {
				type: 'string',
				default: '13316',
			},
			manifestsPath: {
				type: 'string',
				default: './manifests',
			},
		},
	});

	const port = Number(args.values.port);
	const manifestsPath = args.values.manifestsPath ?? './manifests';
	const storybookMcpHandler = await createMcpHandler(manifestsPath);

	serve({
		port,
		async fetch(request: Request) {
			if (new URL(request.url).pathname !== '/mcp') {
				return new Response('Not found', { status: 404 });
			}

			return await storybookMcpHandler(request);
		},
	});

	console.log(`@storybook/mcp example server listening on http://localhost:${port}/mcp`);
}
