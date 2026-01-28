/**
 * Composition authentication for fetching manifests from private Storybooks.
 *
 * This class handles OAuth discovery and token-based manifest fetching for
 * composed Storybooks (refs). It acts as a proxy for OAuth metadata, allowing
 * MCP clients like VS Code to handle the OAuth flow with Chromatic.
 */

export interface ComposedRef {
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
  path: string
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
      const manifestUrl = `${ref.url}/manifests/components.json`;
      const authReq = await this.checkAuthRequired(manifestUrl);

      if (authReq) {
        this.authRequiredUrls.push(ref.url);
        // Use first auth requirement for .well-known (all must use same OAuth server)
        if (!this.authRequirement) {
          this.authRequirement = authReq;
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
   * Create a manifest provider that fetches from multiple sources.
   * Token is extracted from the request for proper per-request isolation.
   */
  createManifestProvider(
    localOrigin: string,
    refs: ComposedRef[]
  ): ManifestProvider {
    return async (
      request: Request | undefined,
      path: string
    ): Promise<string> => {
      // Extract token from request for this specific request
      const token = extractBearerToken(request?.headers.get('Authorization'));
      // Fetch from local Storybook
      const localUrl = `${localOrigin}${path.replace('./', '/')}`;
      const localManifest = await this.fetchManifest(localUrl, null);

      // Fetch from remote refs
      const remoteManifests = await Promise.all(
        refs.map(async (ref) => {
          const refUrl = `${ref.url}${path.replace('./', '/')}`;
          try {
            const manifest = await this.fetchManifest(refUrl, token);
            return { ref, manifest };
          } catch (error) {
            console.warn(
              `Failed to fetch manifest from ${ref.title}:`,
              error
            );
            return null;
          }
        })
      );

      // Parse and combine manifests
      const localParsed = JSON.parse(localManifest);

      for (const remote of remoteManifests) {
        if (!remote) continue;

        const remoteParsed = JSON.parse(remote.manifest);

        // Combine components (prefix with ref title to avoid collisions)
        if (remoteParsed.components) {
          for (const [id, component] of Object.entries(
            remoteParsed.components
          )) {
            const prefixedId = `${remote.ref.title}/${id}`;
            localParsed.components[prefixedId] = {
              ...(component as object),
              id: prefixedId,
              source: remote.ref.title,
            };
          }
        }

        // Combine docs
        if (remoteParsed.docs) {
          localParsed.docs = localParsed.docs || {};
          for (const [id, doc] of Object.entries(remoteParsed.docs)) {
            const prefixedId = `${remote.ref.title}/${id}`;
            localParsed.docs[prefixedId] = {
              ...(doc as object),
              id: prefixedId,
              source: remote.ref.title,
            };
          }
        }
      }

      return JSON.stringify(localParsed);
    };
  }

  /**
   * Fetch a manifest with optional auth token.
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

    return response.text();
  }

  /**
   * Check if a manifest URL requires authentication.
   * Returns auth info if auth is needed, null if publicly accessible.
   */
  private async checkAuthRequired(
    manifestUrl: string
  ): Promise<AuthRequirement | null> {
    // Try to fetch with Accept: application/json to detect auth requirement
    const response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'manual', // Don't follow 302 redirects
    });

    // 200 with actual manifest content = no auth needed
    if (response.ok) {
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        // If it has loginUrl, auth is needed
        if (json.loginUrl) {
          return this.discoverOAuthFromMcp(manifestUrl);
        }
        // Actual manifest content, no auth needed
        return null;
      } catch {
        // Not JSON, assume it's the manifest
        return null;
      }
    }

    // 302 = redirect to login, auth needed
    if (response.status === 302) {
      return this.discoverOAuthFromMcp(manifestUrl);
    }

    // 401 with WWW-Authenticate = proper OAuth, parse directly
    if (response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        return this.parseAuthFromWwwAuthenticate(wwwAuth);
      }
    }

    return null;
  }

  /**
   * Discover OAuth by hitting the /mcp endpoint (fallback for 302 responses).
   */
  private async discoverOAuthFromMcp(
    manifestUrl: string
  ): Promise<AuthRequirement | null> {
    // Replace manifest path with /mcp
    const url = new URL(manifestUrl);
    url.pathname = '/mcp';

    const response = await fetch(url.toString());

    if (response.status !== 401) {
      return null;
    }

    const wwwAuth = response.headers.get('WWW-Authenticate');
    if (!wwwAuth) {
      return null;
    }

    return this.parseAuthFromWwwAuthenticate(wwwAuth);
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
