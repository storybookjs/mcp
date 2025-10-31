import { createStorybookMcpHandler } from './src/index.ts';
import { serve } from 'srvx';
import fs from 'node:fs/promises';

const storybookMcpHandler = await createStorybookMcpHandler({
	// Use the local fixture file via manifestProvider
	manifestProvider: async (request) => {
		// Read the manifest from the local file system
		// Ignore the request URL and always use the local fixture
		return await fs.readFile(
			'./fixtures/full-manifest.fixture.json',
			'utf-8',
		);
	},
});

serve({
	async fetch(req) {
		const pathname = new URL(req.url).pathname;

		if (pathname === '/mcp') {
			return await storybookMcpHandler(req);
		}

		return new Response('Not found', { status: 404 });
	},
	port: 13316,
});
