import { createMcpHandler } from '../../server.ts';

const manifestsPath = process.env.MANIFESTS_PATH ?? './manifests';

let cachedHandlerPromise: ReturnType<typeof createMcpHandler> | undefined;

export default async function handler(request: Request): Promise<Response> {
	const pathname = new URL(request.url).pathname;
	if (pathname !== '/mcp' && pathname !== '/.netlify/functions/mcp') {
		return new Response('Not found', { status: 404 });
	}

	if (!cachedHandlerPromise) {
		cachedHandlerPromise = createMcpHandler(manifestsPath);
	}

	const mcpHandler = await cachedHandlerPromise;
	return mcpHandler(request);
}
