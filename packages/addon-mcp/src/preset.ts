import { mcpServerHandler } from './mcp-handler.ts';
import type { PresetPropertyFn } from 'storybook/internal/types';
import { AddonOptions } from './types.ts';
import * as v from 'valibot';
import { getManifestStatus } from './tools/is-manifest-available.ts';
import { getAddonVitestConstants } from './tools/run-story-tests.ts';
import { isAddonA11yEnabled } from './utils/is-addon-a11y-enabled.ts';
import htmlTemplate from './template.html';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { CompositionAuth, extractBearerToken, type ComposedRef } from './auth/index.ts';
import { logger } from 'storybook/internal/node-logger';
import { findDeclarationForTag, type CustomElementsManifest, type Source } from '@storybook/mcp';

export const previewAnnotations: PresetPropertyFn<'previewAnnotations'> = async (
	existingAnnotations = [],
) => {
	return [...existingAnnotations, path.join(import.meta.dirname, 'preview.js')];
};

export const experimental_devServer: PresetPropertyFn<'experimental_devServer'> = async (
	app,
	options,
) => {
	// There is no error handling here. This can make the whole storybook app crash with:
	// ValiError: Invalid type: Expected boolean but received "false"
	const addonOptions = v.parse(AddonOptions, {
		toolsets: 'toolsets' in options ? options.toolsets : {},
		manifestProvider: 'manifestProvider' in options ? options.manifestProvider : undefined,
	});

	const origin = `http://localhost:${options.port}`;

	// Get composed Storybook refs from config
	const refs = await getRefsFromConfig(options);
	const compositionAuth = new CompositionAuth();

	// Build sources and manifest provider only if refs are configured
	let sources: Source[] | undefined;
	let manifestProvider:
		| ((request: Request | undefined, path: string, source?: Source) => Promise<string>)
		| undefined;

	if (refs.length > 0) {
		logger.info(`Initializing composition with ${refs.length} remote Storybook(s)`);
		await compositionAuth.initialize(refs);
		if (compositionAuth.requiresAuth) {
			logger.info(`Auth required for: ${compositionAuth.authUrls.join(', ')}`);
		}

		// Build sources array (local + refs)
		sources = compositionAuth.buildSources();
		logger.info(`Sources: ${sources.map((s) => s.id).join(', ')}`);

		// Create manifest provider that handles multi-source
		manifestProvider = compositionAuth.createManifestProvider(origin);
	}

	// Allow user to override the manifest provider (e.g., for web component / composite setups)
	if (addonOptions.manifestProvider) {
		manifestProvider = addonOptions.manifestProvider;
		// When using a custom provider, include all refs as sources regardless of auth check.
		// The custom provider is responsible for resolving URLs (including proxy rewrites).
		if (refs.length > 0) {
			sources = [
				{ id: 'local', url: origin, title: 'Local' },
				...refs.map((ref) => ({ id: ref.id, url: ref.url, title: ref.title })),
			];
		}
	}

	// Serve .well-known/oauth-protected-resource for MCP auth
	app!.get('/.well-known/oauth-protected-resource', (_req, res) => {
		const wellKnown = compositionAuth.buildWellKnown(origin);
		if (!wellKnown) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(wellKnown));
	});

	const requireAuth = (
		req: import('node:http').IncomingMessage,
		res: import('node:http').ServerResponse,
	): boolean => {
		const token = extractBearerToken(req.headers['authorization']);
		if (compositionAuth.requiresAuth && !token) {
			res.writeHead(401, {
				'Content-Type': 'text/plain',
				'WWW-Authenticate': compositionAuth.buildWwwAuthenticate(origin),
			});
			res.end('401 - Unauthorized');
			return true;
		}
		return false;
	};

	app!.post('/mcp', (req, res) => {
		if (requireAuth(req, res)) return;

		return mcpServerHandler({
			req,
			res,
			options,
			addonOptions,
			sources,
			manifestProvider,
			compositionAuth,
		});
	});

	const manifestStatus = await getManifestStatus(options);
	const addonVitestConstants = await getAddonVitestConstants();
	const a11yEnabled = await isAddonA11yEnabled(options);

	const isDevEnabled = addonOptions.toolsets?.dev ?? true;
	const isDocsEnabled =
		(manifestStatus.available || !!addonOptions.manifestProvider) &&
		(addonOptions.toolsets?.docs ?? true);
	const isTestEnabled = !!addonVitestConstants && (addonOptions.toolsets?.test ?? true);

	app!.get('/mcp', (req, res) => {
		if (!req.headers['accept']?.includes('text/html')) {
			if (requireAuth(req, res)) return;

			return mcpServerHandler({
				req,
				res,
				options,
				addonOptions,
				sources,
				manifestProvider,
				compositionAuth,
			});
		}

		// Browser request - send HTML
		res.writeHead(200, { 'Content-Type': 'text/html' });

		let docsNotice = '';
		if (!manifestStatus.hasManifests) {
			docsNotice = `<div class="toolset-notice">
				This toolset is only supported in React-based setups.
			</div>`;
		} else if (!manifestStatus.hasFeatureFlag) {
			docsNotice = `<div class="toolset-notice">
				This toolset requires enabling the component manifest feature.
				<a target="_blank" href="https://github.com/storybookjs/mcp/tree/main/packages/addon-mcp#docs-tools-experimental">Learn how to enable it</a>
			</div>`;
		}

		const testNoticeLines = [
			!addonVitestConstants &&
				`This toolset requires Storybook 10.3.0+ with <code>@storybook/addon-vitest</code>. <a target="_blank" href="https://storybook.js.org/docs/writing-tests/test-addon">Learn how to set it up</a>`,
			!a11yEnabled &&
				`Add <code>@storybook/addon-a11y</code> for accessibility testing. <a target="_blank" href="https://storybook.js.org/docs/writing-tests/accessibility-testing">Learn more</a>`,
		].filter(Boolean);
		const testNotice = testNoticeLines.length
			? `<div class="toolset-notice">${testNoticeLines.join('<br>')}</div>`
			: '';

		const a11yBadge = a11yEnabled
			? ' <span class="toolset-status enabled">+ accessibility</span>'
			: '';

		const html = htmlTemplate
			.replaceAll('{{DEV_STATUS}}', isDevEnabled ? 'enabled' : 'disabled')
			.replaceAll('{{DOCS_STATUS}}', isDocsEnabled ? 'enabled' : 'disabled')
			.replace('{{DOCS_NOTICE}}', docsNotice)
			.replaceAll('{{TEST_STATUS}}', isTestEnabled ? 'enabled' : 'disabled')
			.replace('{{TEST_NOTICE}}', testNotice)
			.replace(
				'{{MANIFEST_DEBUGGER_LINK}}',
				manifestStatus.available
					? '<p>View the <a href="/manifests/components.html">component manifest debugger</a>.</p>'
					: '',
			)
			.replace('{{A11Y_BADGE}}', a11yBadge);
		res.end(html);
	});
	return app;
};

export const features: PresetPropertyFn<'features'> = async (existingFeatures) => {
	return {
		...existingFeatures,
		componentsManifest: true,
	};
};

type ManifestEntry = {
	id: string;
	title: string;
	name: string;
	importPath: string;
	type: string;
};

/**
 * Generates a component manifest from a Custom Elements Manifest (custom-elements.json).
 * Called by Storybook during build to populate manifests/components.json for web component projects.
 * Passthrough when no custom-elements.json is found, so non-web-component projects are unaffected.
 */
export const experimental_manifests = async (
	existingManifests: unknown,
	{ manifestEntries = [] }: { manifestEntries?: ManifestEntry[] } = {},
): Promise<Record<string, unknown>> => {
	let cem: CustomElementsManifest | undefined;
	try {
		const raw = await readFile(path.join(process.cwd(), 'custom-elements.json'), 'utf-8');
		cem = JSON.parse(raw) as CustomElementsManifest;
	} catch {
		return existingManifests != null && typeof existingManifests === 'object'
			? (existingManifests as Record<string, unknown>)
			: {};
	}

	const byTitle = new Map<string, ManifestEntry[]>();
	for (const entry of manifestEntries) {
		if (entry.type !== 'story') continue;
		const group = byTitle.get(entry.title) ?? [];
		group.push(entry);
		byTitle.set(entry.title, group);
	}

	const components: Record<string, unknown> = {};
	for (const [title, entries] of byTitle) {
		const first = entries[0]!; // safe: entries only added when non-empty above
		const componentId = first.id.replace(/--[^-]+$/, '');
		const name = title.split('/').pop() ?? title;
		const tagName = deriveTagName(title);
		const cemDecl = findDeclarationForTag(cem, tagName);

		components[componentId] = {
			id: componentId,
			name,
			path: first.importPath,
			stories: entries.map((e) => ({ id: e.id, name: e.name })),
			...(cemDecl ? { customElementsManifest: cemDecl } : {}),
		};
	}

	return {
		...(existingManifests != null && typeof existingManifests === 'object'
			? (existingManifests as Record<string, unknown>)
			: {}),
		components: { v: 1, components },
	};
};

/**
 * Derives a custom element tag name from a Storybook story title segment.
 * Handles both space-separated ("Jha Button" → "jha-button") and
 * CamelCase ("JhaButton" → "jha-button") naming conventions.
 * Returns undefined for non-hyphenated names (not a custom element).
 */
function deriveTagName(title: string): string | undefined {
	const segment = title.split('/').pop() ?? '';
	const kebab = segment
		.replace(/\s+/g, '-')
		.replace(/([a-z])([A-Z])/g, '$1-$2')
		.toLowerCase()
		.replace(/^-/, '')
		.replace(/-+/g, '-');
	return kebab.includes('-') ? kebab : undefined;
}

/**
 * Get composed Storybook refs from Storybook config.
 * See: https://storybook.js.org/docs/sharing/storybook-composition
 */
async function getRefsFromConfig(options: any): Promise<ComposedRef[]> {
	try {
		// Get refs from Storybook presets
		const refs = await options.presets.apply('refs', {});

		if (!refs || typeof refs !== 'object') {
			return [];
		}

		// Convert refs object to array, using the config key as the stable ID
		return Object.entries(refs)
			.map(([key, value]: [string, any]) => ({
				id: key,
				title: value.title || key,
				url: value.url,
			}))
			.filter((ref) => ref.url); // Only include refs with URLs
	} catch {
		return [];
	}
}
