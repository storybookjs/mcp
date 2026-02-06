import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompositionAuth, extractBearerToken } from './composition-auth.ts';

describe('CompositionAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractBearerToken', () => {
    it('extracts token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    });

    it('returns null for non-Bearer header', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(extractBearerToken(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(extractBearerToken(null)).toBeNull();
    });

    it('returns null for array header', () => {
      expect(extractBearerToken(['Bearer abc'])).toBeNull();
    });
  });

  describe('requiresAuth', () => {
    it('returns false when no refs initialized', () => {
      const auth = new CompositionAuth();
      expect(auth.requiresAuth).toBe(false);
    });
  });

  describe('buildWellKnown', () => {
    it('returns null when no auth requirement', () => {
      const auth = new CompositionAuth();
      expect(auth.buildWellKnown('http://localhost:6006')).toBeNull();
    });
  });

  describe('buildWwwAuthenticate', () => {
    it('builds correct header', () => {
      const auth = new CompositionAuth();
      const header = auth.buildWwwAuthenticate('http://localhost:6006');
      expect(header).toContain('Bearer');
      expect(header).toContain('resource_metadata=');
      expect(header).toContain('http://localhost:6006/.well-known/oauth-protected-resource');
    });
  });

  describe('buildSources', () => {
    it('creates sources array with local first', () => {
      const auth = new CompositionAuth();
      const sources = auth.buildSources([
        { id: 'design-system', title: 'Design System', url: 'http://ds.example.com' },
      ]);

      expect(sources).toEqual([
        { id: 'local', title: 'Local' },
        { id: 'design-system', title: 'Design System', url: 'http://ds.example.com' },
      ]);
    });

    it('uses ref id as source id', () => {
      const auth = new CompositionAuth();
      const sources = auth.buildSources([
        { id: 'my-ref-key', title: 'Some Title', url: 'http://example.com' },
      ]);

      expect(sources[1].id).toBe('my-ref-key');
    });

    it('handles multiple refs', () => {
      const auth = new CompositionAuth();
      const sources = auth.buildSources([
        { id: 'ref-a', title: 'Ref A', url: 'http://a.example.com' },
        { id: 'ref-b', title: 'Ref B', url: 'http://b.example.com' },
      ]);

      expect(sources).toHaveLength(3);
      expect(sources.map((s) => s.id)).toEqual(['local', 'ref-a', 'ref-b']);
    });
  });

  describe('createManifestProvider', () => {
    it('creates a manifest provider function', () => {
      const auth = new CompositionAuth();
      const provider = auth.createManifestProvider('http://localhost:6006');
      expect(typeof provider).toBe('function');
    });

    it('fetches from local origin when no source provided', async () => {
      const auth = new CompositionAuth();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"components":{}}'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = auth.createManifestProvider('http://localhost:6006');
      const request = new Request('http://localhost:6006/mcp');

      await provider(request, './manifests/components.json');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6006/manifests/components.json',
        expect.any(Object)
      );
    });

    it('fetches from source URL when source provided', async () => {
      const auth = new CompositionAuth();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"components":{}}'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = auth.createManifestProvider('http://localhost:6006');
      const request = new Request('http://localhost:6006/mcp');
      const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

      await provider(request, './manifests/components.json', source);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://remote.example.com/manifests/components.json',
        expect.any(Object)
      );
    });

    it('extracts token from request headers for auth-required sources', async () => {
      const auth = new CompositionAuth();
      // Simulate that this URL requires auth
      (auth as any).authRequiredUrls = ['http://remote.example.com'];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('{"components":{}}'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const provider = auth.createManifestProvider('http://localhost:6006');

      const request = new Request('http://localhost:6006/mcp', {
        headers: { Authorization: 'Bearer test-token-123' },
      });
      const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

      await provider(request, './manifests/components.json', source);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://remote.example.com/manifests/components.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      );
    });
  });

  describe('fetchManifest (via createManifestProvider)', () => {
    it('throws auth error when server returns loginUrl response', async () => {
      const auth = new CompositionAuth();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('{"loginUrl":"https://www.chromatic.com/login"}'),
        })
      );

      const provider = auth.createManifestProvider('http://localhost:6006');
      const request = new Request('http://localhost:6006/mcp', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

      await expect(
        provider(request, './manifests/components.json', source)
      ).rejects.toThrow('Authentication failed');
    });

    it('returns manifest content when response is valid JSON manifest', async () => {
      const auth = new CompositionAuth();
      const manifestJson = '{"v":1,"components":{"button":{"id":"button"}}}';

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(manifestJson),
        })
      );

      const provider = auth.createManifestProvider('http://localhost:6006');
      const request = new Request('http://localhost:6006/mcp');

      const result = await provider(request, './manifests/components.json');
      expect(result).toBe(manifestJson);
    });
  });

  describe('initialize', () => {
    it('detects public refs (no auth needed)', async () => {
      const auth = new CompositionAuth();

      // Mock: /mcp returns 200 (no auth required)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
        })
      );

      await auth.initialize([{ id: 'public', title: 'public', url: 'http://public.example.com' }]);

      expect(auth.requiresAuth).toBe(false);
      expect(auth.authUrls).toHaveLength(0);
    });

    it('warns when refs use different OAuth servers', async () => {
      const auth = new CompositionAuth();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Mock two refs: both /mcp endpoints return 401 with different OAuth servers
      vi.stubGlobal(
        'fetch',
        vi.fn()
          // First ref: /mcp returns 401
          .mockResolvedValueOnce({
            status: 401,
            headers: new Headers({
              'WWW-Authenticate': 'Bearer resource_metadata="https://chromatic.com/.well-known/oauth-protected-resource"',
            }),
          })
          // First ref: resource metadata
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              resource: 'https://chromatic.com/mcp',
              authorization_servers: ['https://www.chromatic.com'],
            }),
          })
          // First ref: server metadata
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              issuer: 'https://www.chromatic.com',
              authorization_endpoint: 'https://www.chromatic.com/authorize',
              token_endpoint: 'https://www.chromatic.com/token',
            }),
          })
          // Second ref: /mcp returns 401 with different server
          .mockResolvedValueOnce({
            status: 401,
            headers: new Headers({
              'WWW-Authenticate': 'Bearer resource_metadata="https://other.example.com/.well-known/oauth-protected-resource"',
            }),
          })
          // Second ref: resource metadata
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              resource: 'https://other.example.com/mcp',
              authorization_servers: ['https://other.example.com'],
            }),
          })
          // Second ref: server metadata
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
              issuer: 'https://other.example.com',
              authorization_endpoint: 'https://other.example.com/authorize',
              token_endpoint: 'https://other.example.com/token',
            }),
          })
      );

      await auth.initialize([
        { id: 'chromatic', title: 'Chromatic', url: 'https://private.chromatic.com' },
        { id: 'other', title: 'Other', url: 'https://other.example.com' },
      ]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('different OAuth server')
      );
    });

    it('detects private refs via /mcp 401 response', async () => {
      const auth = new CompositionAuth();

      // Mock: /mcp returns 401, then resource + server metadata
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({
            status: 401,
            headers: new Headers({
              'WWW-Authenticate':
                'Bearer resource_metadata="https://chromatic.com/.well-known/oauth-protected-resource"',
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              Promise.resolve({
                resource: 'https://chromatic.com/mcp',
                authorization_servers: ['https://www.chromatic.com'],
              }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () =>
              Promise.resolve({
                issuer: 'https://www.chromatic.com',
                authorization_endpoint: 'https://www.chromatic.com/authorize',
                token_endpoint: 'https://www.chromatic.com/token',
              }),
          })
      );

      await auth.initialize([{ id: 'private', title: 'private', url: 'https://private.chromatic.com' }]);

      expect(auth.requiresAuth).toBe(true);
      expect(auth.authUrls).toContain('https://private.chromatic.com');

      const wellKnown = auth.buildWellKnown('http://localhost:6006');
      expect(wellKnown).toEqual({
        resource: 'http://localhost:6006/mcp',
        authorization_servers: ['https://www.chromatic.com'],
        scopes_supported: undefined,
      });
    });
  });
});
