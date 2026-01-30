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

  describe('initialize', () => {
    it('detects public refs (no auth needed)', async () => {
      const auth = new CompositionAuth();

      // Mock fetch to return public manifest
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('{"v":1,"components":{}}'),
        })
      );

      await auth.initialize([{ title: 'public', url: 'http://public.example.com' }]);

      expect(auth.requiresAuth).toBe(false);
      expect(auth.authUrls).toHaveLength(0);
    });

    it('detects private refs via loginUrl response', async () => {
      const auth = new CompositionAuth();

      // Mock fetch sequence: manifest returns loginUrl, then /mcp returns 401
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve('{"loginUrl":"https://chromatic.com/login"}'),
          })
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

      await auth.initialize([{ title: 'private', url: 'https://private.chromatic.com' }]);

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
