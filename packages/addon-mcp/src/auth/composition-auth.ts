/**
 * Composition authentication for fetching manifests from private Storybooks.
 *
 * This class handles OAuth discovery and token-based manifest fetching for
 * composed Storybooks (refs). It acts as a proxy for OAuth metadata, allowing
 * MCP clients like VS Code to handle the OAuth flow with Chromatic.
 */

import { ComponentManifestMap, DocsManifestMap, type Source } from '@storybook/mcp';
import * as v from 'valibot';

export interface ComposedRef {
	id: string;
	title: string;
	url: string;
}

export interface OAuthResourceMetadata {
	resource: string;
	authorization_servers: string[];
	scopes_supported?: string[];
}

export interface OAuthServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	scopes_supported?: string[];
}

interface AuthRequirement {
	resourceMetadataUrl: string;
	resourceMetadata: OAuthResourceMetadata;
	serverMetadata: OAuthServerMetadata;
}

export type ManifestProvider = (
	request: Request | undefined,
	path: string,
	source?: Source,
) => Promise<string>;

const MANIFEST_CACHE_TTL = 60 * 60 * 1000; // 60 minutes

interface CacheEntry {
	text: string;
	timestamp: number;
	revalidating?: boolean;
}

export class CompositionAuth {
	private authRequirement: AuthRequirement | null = null;
	private authRequiredUrls: string[] = [];
	private manifestCache = new Map<string, CacheEntry>();
	private lastToken: string | null = null;

	/** Initialize by checking which refs require authentication. */
	async initialize(refs: ComposedRef[]): Promise<void> {
		for (const ref of refs) {
			try {
				const authReq = await this.checkAuthRequired(ref.url);
				if (!authReq) continue;

				this.authRequiredUrls.push(ref.url);
				if (!this.authRequirement) {
					this.authRequirement = authReq;
				} else {
					const existingServer = this.authRequirement.resourceMetadata.authorization_servers[0];
					const newServer = authReq.resourceMetadata.authorization_servers[0];
					if (existingServer !== newServer) {
						console.warn(
							`[addon-mcp] Composed ref "${ref.title}" uses a different OAuth server (${newServer}) than the first authenticated ref (${existingServer}). Only the first OAuth server will be used for authentication.`,
						);
					}
				}
			} catch (error) {
				console.warn(
					`[addon-mcp] Failed to check auth for composed ref "${ref.title}" (${ref.url}): ${error instanceof Error ? error.message : String(error)}. Skipping this ref.`,
				);
			}
		}
	}

	get requiresAuth(): boolean {
		return this.authRequiredUrls.length > 0;
	}

	get authUrls(): string[] {
		return this.authRequiredUrls;
	}

	/** Build .well-known/oauth-protected-resource response. */
	buildWellKnown(origin: string): object | null {
		if (!this.authRequirement) return null;
		return {
			resource: `${origin}/mcp`,
			authorization_servers: this.authRequirement.resourceMetadata.authorization_servers,
			scopes_supported: this.authRequirement.resourceMetadata.scopes_supported,
		};
	}

	/** Build WWW-Authenticate header for 401 responses */
	buildWwwAuthenticate(origin: string): string {
		return `Bearer error="unauthorized", error_description="Authorization needed for composed Storybooks", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	}

	/** Build sources configuration: local first, then each ref. */
	buildSources(refs: ComposedRef[]): Source[] {
		return [
			{ id: 'local', title: 'Local' },
			...refs.map((ref) => ({ id: ref.id, title: ref.title, url: ref.url })),
		];
	}

	/** Create a manifest provider for multi-source mode. */
	createManifestProvider(localOrigin: string): ManifestProvider {
		return async (request, path, source) => {
			const token = extractBearerToken(request?.headers.get('Authorization'));
			const baseUrl = source?.url ?? localOrigin;
			const manifestUrl = `${baseUrl}${path.replace('./', '/')}`;
			const isRemote = !!source?.url;

			// New token = user re-authenticated, invalidate all cached manifests
			if (token && token !== this.lastToken) {
				this.manifestCache.clear();
				this.lastToken = token;
			}

			if (isRemote) {
				const cached = this.manifestCache.get(manifestUrl);
				if (cached) {
					const isStale = Date.now() - cached.timestamp > MANIFEST_CACHE_TTL;
					if (isStale && !cached.revalidating) {
						// Stale — serve cached, revalidate in background
						cached.revalidating = true;
						this.fetchManifest(manifestUrl, token).then(
							(text) => this.manifestCache.set(manifestUrl, { text, timestamp: Date.now() }),
							() => {
								cached.revalidating = false;
							},
						);
					}
					return cached.text;
				}
			}

			const text = await this.fetchManifest(manifestUrl, isRemote ? token : null);

			if (isRemote) {
				this.manifestCache.set(manifestUrl, { text, timestamp: Date.now() });
			}

			return text;
		};
	}

	/**
	 * Fetch a manifest with optional auth token.
	 * If the response is 200 but not a valid manifest, checks /mcp for auth issues.
	 */
	private async fetchManifest(url: string, token: string | null): Promise<string> {
		const headers: HeadersInit = { Accept: 'application/json' };
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const response = await fetch(url, { headers });

		if (response.status === 401) {
			throw new Error(`Authentication failed for ${url}. Your token may be invalid or expired.`);
		}

		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status}`);
		}

		const text = await response.text();
		const schema = url.includes('docs.json') ? DocsManifestMap : ComponentManifestMap;

		if (v.safeParse(v.pipe(v.string(), v.parseJson(), schema), text).success) {
			return text;
		}

		// Invalid manifest — check /mcp to see if it's an auth issue
		if (await this.isMcpUnauthorized(new URL(url).origin)) {
			throw new Error(`Authentication failed for ${url}. Your token may be invalid or expired.`);
		}

		throw new Error(
			`Invalid manifest response from ${url}: expected valid JSON manifest but got unexpected content.`,
		);
	}

	/**
	 * Check if a remote Storybook requires authentication.
	 * Tries the manifest endpoint first (401 = direct auth signal),
	 * falls back to /mcp if the manifest response is unexpected.
	 */
	private async checkAuthRequired(refUrl: string): Promise<AuthRequirement | null> {
		const response = await fetch(`${refUrl}/manifests/components.json`, {
			headers: { Accept: 'application/json' },
		});

		// 401 with WWW-Authenticate = auth needed
		const authReq = await this.parseAuthFromResponse(response);
		if (authReq) return authReq;

		// 200 with valid manifest = no auth needed
		if (response.ok) {
			const text = await response.text();
			if (v.safeParse(v.pipe(v.string(), v.parseJson(), ComponentManifestMap), text).success) {
				return null;
			}
		}

		// Unexpected response — fall back to /mcp
		return this.checkMcpAuth(refUrl);
	}

	/** Check /mcp endpoint for 401 auth requirement. */
	private async checkMcpAuth(refUrl: string): Promise<AuthRequirement | null> {
		const response = await fetch(`${refUrl}/mcp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		});
		return this.parseAuthFromResponse(response);
	}

	/** Quick check: does the remote /mcp return 401? */
	private async isMcpUnauthorized(origin: string): Promise<boolean> {
		try {
			const response = await fetch(`${origin}/mcp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
			return response.status === 401;
		} catch {
			return false;
		}
	}

	/** Extract auth requirement from a 401 response's WWW-Authenticate header. */
	private async parseAuthFromResponse(response: Response): Promise<AuthRequirement | null> {
		if (response.status !== 401) return null;
		const wwwAuth = response.headers.get('WWW-Authenticate');
		if (!wwwAuth) return null;

		const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
		if (!match?.[1]) return null;

		const resourceMetadataUrl = match[1];
		const resourceResponse = await fetch(resourceMetadataUrl);
		if (!resourceResponse.ok) {
			console.warn(
				`[addon-mcp] Failed to fetch OAuth resource metadata from ${resourceMetadataUrl}: ${resourceResponse.status}`,
			);
			return null;
		}
		const resourceMetadata: OAuthResourceMetadata = await resourceResponse.json();

		const authServer = resourceMetadata.authorization_servers[0];
		const serverMetadataUrl = `${authServer}/.well-known/oauth-authorization-server`;
		const serverResponse = await fetch(serverMetadataUrl);
		if (!serverResponse.ok) {
			console.warn(
				`[addon-mcp] Failed to fetch OAuth server metadata from ${serverMetadataUrl}: ${serverResponse.status}`,
			);
			return null;
		}
		const serverMetadata: OAuthServerMetadata = await serverResponse.json();

		return { resourceMetadataUrl, resourceMetadata, serverMetadata };
	}
}

/**
 * Extract Bearer token from Authorization header.
 * Handles both Node.js (string | string[] | undefined) and Web API (string | null) headers.
 */
export function extractBearerToken(
	authHeader: string | string[] | null | undefined,
): string | null {
	if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
		return authHeader.slice(7);
	}
	return null;
}
