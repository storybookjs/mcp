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
  source?: Source
) => Promise<string>;

export class CompositionAuth {
  private authRequirement: AuthRequirement | null = null;
  private authRequiredUrls: string[] = [];

  /**
   * Initialize by checking which refs require authentication.
   * Should be called once during server startup.
   */
  async initialize(refs: ComposedRef[]): Promise<void> {
    for (const ref of refs) {
      const authReq = await this.checkAuthRequired(ref.url);

      if (authReq) {
        this.authRequiredUrls.push(ref.url);
        if (!this.authRequirement) {
          this.authRequirement = authReq;
        } else {
          const existingServer = this.authRequirement.resourceMetadata.authorization_servers[0];
          const newServer = authReq.resourceMetadata.authorization_servers[0];
          if (existingServer !== newServer) {
            console.warn(
              `[addon-mcp] Composed ref "${ref.title}" uses a different OAuth server (${newServer}) than the first authenticated ref (${existingServer}). Only the first OAuth server will be used for authentication.`
            );
          }
        }
      }
    }
  }

  /** Whether any ref requires authentication */
  get requiresAuth(): boolean {
    return this.authRequiredUrls.length > 0;
  }

  /** URLs that require authentication */
  get authUrls(): string[] {
    return this.authRequiredUrls;
  }

  /**
   * Build .well-known/oauth-protected-resource response.
   * Proxies the discovered OAuth metadata, making addon-mcp
   * appear as the resource server to the MCP client.
   */
  buildWellKnown(origin: string): object | null {
    if (!this.authRequirement) {
      return null;
    }

    return {
      resource: `${origin}/mcp`,
      authorization_servers:
        this.authRequirement.resourceMetadata.authorization_servers,
      scopes_supported:
        this.authRequirement.resourceMetadata.scopes_supported,
    };
  }

  /** Build WWW-Authenticate header for 401 responses */
  buildWwwAuthenticate(origin: string): string {
    return `Bearer error="unauthorized", error_description="Authorization needed for composed Storybooks", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  }

  /**
   * Build sources configuration from refs.
   * Creates a Source array with 'local' as the first entry, followed by each ref.
   */
  buildSources(refs: ComposedRef[]): Source[] {
    const sources: Source[] = [{ id: 'local', title: 'Local' }];

    for (const ref of refs) {
      sources.push({
        id: ref.id,
        title: ref.title,
        url: ref.url,
      });
    }

    return sources;
  }

  /**
   * Create a manifest provider for multi-source mode.
   * Each source is fetched independently based on the source parameter.
   * Token is extracted from the request for proper per-request isolation.
   */
  createManifestProvider(localOrigin: string): ManifestProvider {
    return async (
      request: Request | undefined,
      path: string,
      source?: Source
    ): Promise<string> => {
      // Extract token from request
      const token = extractBearerToken(request?.headers.get('Authorization'));

      // Determine base URL for this source (default to local if no source provided)
      const baseUrl = source?.url ?? localOrigin;
      const manifestUrl = `${baseUrl}${path.replace('./', '/')}`;

      // Always forward token for remote sources (server will ignore if not needed)
      // Token is only used for remote sources (source?.url), not local
      const isRemote = !!source?.url;
      return this.fetchManifest(manifestUrl, isRemote ? token : null);
    };
  }

  /**
   * Fetch a manifest with optional auth token.
   * If the response is 200 but not a valid manifest, checks /mcp for auth issues.
   */
  private async fetchManifest(
    url: string,
    token: string | null
  ): Promise<string> {
    const headers: HeadersInit = {
      Accept: 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const text = await response.text();

    // Validate the response against the manifest schemas
    const schema = url.includes('docs.json') ? DocsManifestMap : ComponentManifestMap;
    const parseResult = v.safeParse(v.pipe(v.string(), v.parseJson(), schema), text);

    if (parseResult.success) {
      return text;
    }

    // Invalid manifest response — check /mcp to see if it's an auth issue
    const baseUrl = new URL(url).origin;
    const mcpResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    if (mcpResponse.status === 401) {
      throw new Error(
        `Authentication failed for ${url}. Your token may be invalid or expired.`
      );
    }

    // Not an auth issue — return the text, let the manifest parser handle the error
    return text;
  }

  /**
   * Check if a remote Storybook requires authentication.
   * First checks the manifest endpoint directly (401 = auth needed).
   * If the manifest returns 200 but with unexpected content, falls back to /mcp.
   */
  private async checkAuthRequired(
    refUrl: string
  ): Promise<AuthRequirement | null> {
    const manifestUrl = `${refUrl}/manifests/components.json`;

    const response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json' },
    });

    // 401 with WWW-Authenticate from manifest endpoint = auth needed
    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        return this.parseAuthFromWwwAuthenticate(wwwAuth);
      }
    }

    // 200 = check if it's a valid manifest
    if (response.ok) {
      const text = await response.text();
      const parseResult = v.safeParse(
        v.pipe(v.string(), v.parseJson(), ComponentManifestMap),
        text,
      );
      if (parseResult.success) {
        // Valid manifest, no auth needed
        return null;
      }
      // 200 but not a valid manifest — fall back to /mcp
      return this.checkMcpEndpointAuth(refUrl);
    }

    // Other status codes — fall back to /mcp
    return this.checkMcpEndpointAuth(refUrl);
  }

  /**
   * Fall back to checking the /mcp endpoint for auth requirements.
   */
  private async checkMcpEndpointAuth(
    refUrl: string
  ): Promise<AuthRequirement | null> {
    const mcpUrl = `${refUrl}/mcp`;
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        return this.parseAuthFromWwwAuthenticate(wwwAuth);
      }
    }

    return null;
  }

  /**
   * Parse OAuth metadata from WWW-Authenticate header.
   */
  private async parseAuthFromWwwAuthenticate(
    wwwAuth: string
  ): Promise<AuthRequirement | null> {
    // Extract resource_metadata URL from header
    // Format: Bearer error="...", resource_metadata="https://..."
    const resourceMetadataMatch = wwwAuth.match(
      /resource_metadata="([^"]+)"/
    );
    if (!resourceMetadataMatch?.[1]) {
      return null;
    }

    const resourceMetadataUrl = resourceMetadataMatch[1];

    // Fetch resource metadata
    const resourceResponse = await fetch(resourceMetadataUrl);
    if (!resourceResponse.ok) {
      return null;
    }
    const resourceMetadata: OAuthResourceMetadata =
      await resourceResponse.json();

    // Fetch auth server metadata
    const authServer = resourceMetadata.authorization_servers[0];
    const serverMetadataUrl = `${authServer}/.well-known/oauth-authorization-server`;
    const serverResponse = await fetch(serverMetadataUrl);
    if (!serverResponse.ok) {
      return null;
    }
    const serverMetadata: OAuthServerMetadata = await serverResponse.json();

    return {
      resourceMetadataUrl,
      resourceMetadata,
      serverMetadata,
    };
  }
}

/**
 * Extract Bearer token from Authorization header.
 * Handles both Node.js (string | string[] | undefined) and Web API (string | null) headers.
 */
export function extractBearerToken(
  authHeader: string | string[] | null | undefined
): string | null {
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}
