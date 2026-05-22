/**
 * Composition authentication for fetching manifests from private Storybooks.
 *
 * This class handles OAuth discovery and token-based manifest fetching for
 * composed Storybooks (refs). It acts as a proxy for OAuth metadata, allowing
 * MCP clients like VS Code to handle the OAuth flow with Chromatic.
 */

import {
	ComponentManifestMap,
	DocsManifestMap,
	type ManifestProvider,
	type Source,
	type SourceManifestFailure,
} from '@storybook/mcp';
import * as v from 'valibot';

export interface ComposedRef {
	id: string;
	title: string;
	url: string;
}

type RemoteSource = Source & { url: string };

const OAuthResourceMetadata = v.object({
	resource: v.optional(v.string()),
	authorization_servers: v.pipe(v.array(v.string()), v.minLength(1)),
	scopes_supported: v.optional(v.array(v.string())),
});
export type OAuthResourceMetadata = v.InferOutput<typeof OAuthResourceMetadata>;

const OAuthServerMetadata = v.object({
	issuer: v.string(),
	authorization_endpoint: v.string(),
	token_endpoint: v.string(),
	scopes_supported: v.optional(v.array(v.string())),
});
export type OAuthServerMetadata = v.InferOutput<typeof OAuthServerMetadata>;

interface AuthRequirement {
	resourceMetadataUrl: string;
	resourceMetadata: OAuthResourceMetadata;
	serverMetadata: OAuthServerMetadata;
}

interface McpAuthCheck {
	unauthorized: boolean;
	authRequirement: AuthRequirement | null;
}

type SourceState =
	| {
			kind: 'public';
			ref: ComposedRef;
	  }
	| {
			kind: 'requires-auth';
			ref: ComposedRef;
			authRequirement: AuthRequirement;
	  }
	| {
			kind: 'unknown';
			ref: ComposedRef;
	  };

export type RequestAccessKind = 'oauth-client' | 'local-proxy';

export interface RequestAccess {
	kind: RequestAccessKind;
	token: string | null;
	authError: AuthenticationError | null;
}

const MANIFEST_CACHE_TTL = 60 * 60 * 1000; // 60 minutes
const REVALIDATION_TTL = 60 * 1000; // 60 seconds
export const STORYBOOK_MCP_PROXY_HEADER = 'X-Storybook-MCP-Proxy';
export const STORYBOOK_MCP_PROXY_HEADER_VALUE = 'true';

interface CacheEntry {
	text: string;
	timestamp: number;
	lastRevalidatedAt?: number;
}

export class AuthenticationError extends Error {
	constructor(
		url: string,
		public readonly authRequirement: AuthRequirement | null = null,
	) {
		super(`Authentication failed for ${url}. Your token may be invalid or expired.`);
		this.name = 'AuthenticationError';
	}
}

export class CompositionAuth {
	#sourceStates = new Map<string, SourceState>();
	#manifestCache = new Map<string, CacheEntry>();
	#lastToken: string | null = null;

	/** Initialize by checking which refs require authentication and have manifests. */
	async initialize(refs: ComposedRef[]): Promise<void> {
		for (const ref of refs) {
			try {
				const result = await this.#checkRef(ref.url);
				if (result === 'no-manifest') continue;

				if (result === 'public') {
					this.#sourceStates.set(ref.id, { kind: 'public', ref });
					continue;
				}

				this.#recordAuthRequirement(ref, result);
			} catch (error) {
				console.warn(
					`[addon-mcp] Failed to check auth for composed ref "${ref.title}" (${ref.url}): ${error instanceof Error ? error.message : String(error)}. Keeping this ref in the MCP source list for request-time resolution.`,
				);
				this.#sourceStates.set(ref.id, { kind: 'unknown', ref });
			}
		}
	}

	get requiresAuth(): boolean {
		return [...this.#sourceStates.values()].some((state) => state.kind === 'requires-auth');
	}

	get authUrls(): string[] {
		return [...this.#sourceStates.values()]
			.filter((state) => state.kind === 'requires-auth')
			.map((state) => state.ref.url);
	}

	createRequestAccess(request: Request, kind: RequestAccessKind): RequestAccess {
		return {
			kind,
			token: extractBearerToken(request.headers.get('Authorization')),
			authError: null,
		};
	}

	/** Check if a URL requires authentication based on discovered auth requirements. */
	#isAuthRequiredUrl(url: string): boolean {
		return [...this.#sourceStates.values()].some(
			(state) => state.kind === 'requires-auth' && url.startsWith(state.ref.url),
		);
	}

	#recordAuthRequirement(ref: ComposedRef, result: AuthRequirement): void {
		const existingRequirement = this.#firstAuthRequirement();
		const existingServer = existingRequirement?.resourceMetadata.authorization_servers[0];
		const newServer = result.resourceMetadata.authorization_servers[0];
		if (existingServer && existingServer !== newServer) {
			console.warn(
				`[addon-mcp] Composed ref "${ref.title}" uses a different OAuth server (${newServer}) than the first authenticated ref (${existingServer}). Only the first OAuth server will be used for authentication.`,
			);
		}
		this.#sourceStates.set(ref.id, { kind: 'requires-auth', ref, authRequirement: result });
	}

	#firstAuthRequirement(): AuthRequirement | null {
		for (const state of this.#sourceStates.values()) {
			if (state.kind === 'requires-auth') {
				return state.authRequirement;
			}
		}
		return null;
	}

	/** Build .well-known/oauth-protected-resource response. */
	buildWellKnown(origin: string): object | null {
		const authRequirement = this.#firstAuthRequirement();
		if (!authRequirement) return null;
		return {
			resource: `${origin}/mcp`,
			authorization_servers: authRequirement.resourceMetadata.authorization_servers,
			scopes_supported: authRequirement.resourceMetadata.scopes_supported,
		};
	}

	/** Build WWW-Authenticate header for 401 responses */
	buildWwwAuthenticate(origin: string): string {
		return `Bearer error="unauthorized", error_description="Authorization needed for composed Storybooks", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
	}

	/** Build sources configuration: local first, then refs that have manifests or inconclusive startup probes. */
	buildSources(): Source[] {
		return [
			{ id: 'local', title: 'Local' },
			...[...this.#sourceStates.values()].map(({ ref }) => ({
				id: ref.id,
				title: ref.title,
				url: ref.url,
			})),
		];
	}

	/** Create a manifest provider for multi-source mode. */
	createManifestProvider(localOrigin: string, access: RequestAccess): ManifestProvider {
		return async (request, path, source) => {
			const remoteSource = isRemoteSource(source) ? source : undefined;
			const baseUrl = remoteSource?.url ?? localOrigin;
			const manifestUrl = `${baseUrl}${path.replace('./', '/')}`;
			const isRemote = !!remoteSource;
			const needsAuth = isRemote && this.#isAuthRequiredUrl(baseUrl);
			const tokenForRequest = needsAuth ? access.token : null;

			if (needsAuth && !access.token && access.kind === 'local-proxy' && remoteSource) {
				return {
					kind: 'source-failure',
					failure: createRequiresOwnMcpFailure(remoteSource),
				};
			}

			// New token = user re-authenticated, invalidate all cached manifests
			if (access.token && access.token !== this.#lastToken) {
				this.#manifestCache.clear();
				this.#lastToken = access.token;
			}

			if (isRemote) {
				const cached = this.#manifestCache.get(manifestUrl);
				if (cached) {
					const age = Date.now() - cached.timestamp;
					if (age > MANIFEST_CACHE_TTL) {
						// Expired — discard cache, fetch fresh below
						this.#manifestCache.delete(manifestUrl);
					} else {
						// Fresh — serve cached, revalidate in background (at most once per 60s)
						const shouldRevalidate =
							!cached.lastRevalidatedAt || Date.now() - cached.lastRevalidatedAt > REVALIDATION_TTL;
						if (shouldRevalidate) {
							cached.lastRevalidatedAt = Date.now();
							void this.#fetchManifest(manifestUrl, tokenForRequest)
								.then((text) =>
									this.#manifestCache.set(manifestUrl, {
										text,
										timestamp: Date.now(),
										lastRevalidatedAt: Date.now(),
									}),
								)
								.catch(() => {});
						}
						return cached.text;
					}
				}
			}

			try {
				const text = await this.#fetchManifest(manifestUrl, tokenForRequest);

				if (isRemote) {
					this.#manifestCache.set(manifestUrl, { text, timestamp: Date.now() });
				}

				return text;
			} catch (error) {
				if (error instanceof AuthenticationError && request) {
					if (remoteSource && error.authRequirement) {
						this.#recordAuthRequirement(remoteSource, error.authRequirement);
					}
					if (access.kind === 'local-proxy' && !access.token && remoteSource) {
						return {
							kind: 'source-failure',
							failure: createRequiresOwnMcpFailure(remoteSource),
						};
					}
					access.authError = error;
				}
				throw error;
			}
		};
	}

	/**
	 * Fetch a manifest with optional auth token.
	 * If the response is 200 but not a valid manifest, checks /mcp for auth issues.
	 */
	async #fetchManifest(url: string, token: string | null): Promise<string> {
		const headers: HeadersInit = { Accept: 'application/json' };
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const response = await fetch(url, { headers });

		if (response.status === 401) {
			const authRequirement =
				(await this.#parseAuthFromResponse(response)) ??
				(await this.#tryCheckMcpAuth(getStorybookUrlFromManifestUrl(url))).authRequirement;
			throw new AuthenticationError(url, authRequirement);
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
		const mcpAuth = await this.#tryCheckMcpAuth(getStorybookUrlFromManifestUrl(url));
		if (mcpAuth.unauthorized) {
			throw new AuthenticationError(url, mcpAuth.authRequirement);
		}

		throw new Error(
			`Invalid manifest response from ${url}: expected valid JSON manifest but got unexpected content.`,
		);
	}

	/**
	 * Check a ref to determine if it has a manifest and whether it requires auth.
	 * Returns 'public' if the ref has a valid manifest without auth,
	 * 'no-manifest' if no manifest is available, or an AuthRequirement if auth is needed.
	 */
	async #checkRef(refUrl: string): Promise<'public' | 'no-manifest' | AuthRequirement> {
		const response = await fetch(`${refUrl}/manifests/components.json`, {
			headers: { Accept: 'application/json' },
		});

		// 401 with WWW-Authenticate = auth needed
		const authReq = await this.#parseAuthFromResponse(response);
		if (authReq) return authReq;

		// 200 with valid manifest = public, has manifest
		if (response.ok) {
			const text = await response.text();
			if (v.safeParse(v.pipe(v.string(), v.parseJson(), ComponentManifestMap), text).success) {
				return 'public';
			}
		}

		// Unexpected response — fall back to /mcp
		const mcpAuth = await this.#checkMcpAuth(refUrl);
		if (mcpAuth) return mcpAuth;

		// No manifest and no auth — this ref doesn't have manifests
		return 'no-manifest';
	}

	/** Check /mcp endpoint for 401 auth requirement. */
	async #checkMcpAuth(refUrl: string): Promise<AuthRequirement | null> {
		const response = await fetch(`${refUrl}/mcp`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		});
		return this.#parseAuthFromResponse(response);
	}

	/** Best-effort /mcp auth check for request-time discovery. */
	async #tryCheckMcpAuth(storybookUrl: string): Promise<McpAuthCheck> {
		try {
			const response = await fetch(`${storybookUrl}/mcp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			});
			if (response.status !== 401) {
				return { unauthorized: false, authRequirement: null };
			}
			return {
				unauthorized: true,
				authRequirement: await this.#parseAuthFromResponse(response),
			};
		} catch {
			return { unauthorized: false, authRequirement: null };
		}
	}

	/** Extract auth requirement from a 401 response's WWW-Authenticate header. */
	async #parseAuthFromResponse(response: Response): Promise<AuthRequirement | null> {
		if (response.status !== 401) return null;
		const wwwAuth = response.headers?.get('WWW-Authenticate');
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
		const resourceResult = v.safeParse(OAuthResourceMetadata, await resourceResponse.json());
		if (!resourceResult.success) {
			console.warn(
				`[addon-mcp] Invalid OAuth resource metadata from ${resourceMetadataUrl}: ${resourceResult.issues.map((i) => i.message).join(', ')}`,
			);
			return null;
		}

		const authServer = resourceResult.output.authorization_servers[0];
		const serverMetadataUrl = `${authServer}/.well-known/oauth-authorization-server`;
		const serverResponse = await fetch(serverMetadataUrl);
		if (!serverResponse.ok) {
			console.warn(
				`[addon-mcp] Failed to fetch OAuth server metadata from ${serverMetadataUrl}: ${serverResponse.status}`,
			);
			return null;
		}

		const serverResult = v.safeParse(OAuthServerMetadata, await serverResponse.json());
		if (!serverResult.success) {
			console.warn(
				`[addon-mcp] Invalid OAuth server metadata from ${serverMetadataUrl}: ${serverResult.issues.map((i) => i.message).join(', ')}`,
			);
			return null;
		}

		return {
			resourceMetadataUrl,
			resourceMetadata: resourceResult.output,
			serverMetadata: serverResult.output,
		};
	}
}

function isRemoteSource(source: Source | undefined): source is RemoteSource {
	return typeof source?.url === 'string' && source.url.length > 0;
}

function isChromaticUrl(url: string): boolean {
	try {
		const hostname = new URL(url).hostname;
		return hostname === 'chromatic.com' || hostname.endsWith('.chromatic.com');
	} catch {
		return false;
	}
}

function getStorybookUrlFromManifestUrl(manifestUrl: string): string {
	const url = new URL(manifestUrl);
	url.pathname = url.pathname.replace(/\/manifests\/(?:components|docs)\.json$/, '');
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/$/, '');
}

function createRequiresOwnMcpFailure(source: RemoteSource): SourceManifestFailure {
	const mcpEndpoint = `${source.url.replace(/\/$/, '')}/mcp`;

	return {
		kind: 'requires-own-mcp',
		endpoint: mcpEndpoint,
		authProvider: isChromaticUrl(source.url) ? 'chromatic' : 'unknown',
	};
}

/**
 * Extract Bearer token from Authorization header.
 * Handles both Node.js (string | string[] | undefined) and Web API (string | null) headers.
 */
export function extractBearerToken(
	authHeader: string | string[] | null | undefined,
): string | null {
	const values = Array.isArray(authHeader) ? authHeader : [authHeader];
	const bearer = values.find((value) => typeof value === 'string' && value.startsWith('Bearer '));
	return bearer ? bearer.slice(7) : null;
}

export function isStorybookMcpProxyRequest(
	headerValue: string | string[] | null | undefined,
): boolean {
	const values = Array.isArray(headerValue) ? headerValue : [headerValue];
	return values.some(
		(value) =>
			typeof value === 'string' && value.trim().toLowerCase() === STORYBOOK_MCP_PROXY_HEADER_VALUE,
	);
}
