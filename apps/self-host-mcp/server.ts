import { createStorybookMcpHandler } from '@storybook/mcp';
import fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Maps a manifest provider path to its `{ base, rel }` location.
 *
 * Top-level manifests (`./manifests/<name>.json`) live in `manifestsPath`; split/ref
 * payloads (`./services/<service>/<id>.json`) live in a sibling `services/` directory,
 * so they resolve against the Storybook build root (the parent of `manifestsPath`).
 */
function resolveManifestTarget(
	manifestsPath: string,
	path: string,
	isRemote: boolean,
): { base: string; rel: string } {
	const normalized = path.replace(/^\.?\//, '');
	if (normalized.startsWith('manifests/')) {
		return { base: manifestsPath, rel: normalized.slice('manifests/'.length) };
	}
	// `services/...` is a sibling of the manifests directory (the build root).
	const root = isRemote ? manifestsPath.replace(/\/[^/]+\/?$/, '') : dirname(manifestsPath);
	return { base: root, rel: normalized };
}

export function createMcpHandler(manifestsPath: string) {
	return createStorybookMcpHandler({
		manifestProvider: async (_request: Request | undefined, path: string) => {
			const isRemote = manifestsPath.startsWith('http://') || manifestsPath.startsWith('https://');
			const { base, rel } = resolveManifestTarget(manifestsPath, path, isRemote);

			if (isRemote) {
				const url = `${base.replace(/\/$/, '')}/${rel}`;
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`,
					);
				}
				return await response.text();
			}

			return await fs.readFile(resolve(base, rel), 'utf-8');
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

	const storybookMcpHandler = await createMcpHandler(args.values.manifestsPath);

	serve({
		port: Number(args.values.port),
		async fetch(request: Request) {
			if (new URL(request.url).pathname !== '/mcp') {
				return new Response('Not found', { status: 404 });
			}

			return await storybookMcpHandler(request);
		},
	});

	console.log(
		`@storybook/mcp example server listening on http://localhost:${args.values.port}/mcp`,
	);
}
