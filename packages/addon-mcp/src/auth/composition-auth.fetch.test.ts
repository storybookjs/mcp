import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompositionAuth } from './composition-auth.ts';

function createManifestProvider(
	auth: CompositionAuth,
	request = new Request('http://localhost:6006/mcp'),
	kind: 'oauth-client' | 'local-proxy' = 'oauth-client',
) {
	const access = auth.createRequestAccess(request, kind);
	return {
		access,
		provider: auth.createManifestProvider('http://localhost:6006', access),
	};
}

describe('CompositionAuth manifest fetching', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns manifest content when response is valid', async () => {
		const auth = new CompositionAuth();
		const manifestJson =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button"}}}';

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve(manifestJson),
			}),
		);

		const { provider } = createManifestProvider(auth);
		const request = new Request('http://localhost:6006/mcp');

		const result = await provider(request, './manifests/components.json');
		expect(result).toBe(manifestJson);
	});

	it('throws when fetch returns non-ok response', async () => {
		const auth = new CompositionAuth();

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
			}),
		);

		const { provider } = createManifestProvider(auth);
		const request = new Request('http://localhost:6006/mcp');
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow(
			'Failed to fetch',
		);
	});

	it('throws auth error when remote returns 401 directly', async () => {
		const auth = new CompositionAuth();

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 401,
			}),
		);

		const request = new Request('http://localhost:6006/mcp', {
			headers: { Authorization: 'Bearer expired-token' },
		});
		const { provider } = createManifestProvider(auth, request);
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow(
			'Authentication failed',
		);
	});

	it('throws auth error when response is invalid manifest and /mcp returns 401', async () => {
		const auth = new CompositionAuth();

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					text: () => Promise.resolve('{"some":"unexpected"}'),
				})
				.mockResolvedValueOnce({
					status: 401,
				}),
		);

		const request = new Request('http://localhost:6006/mcp', {
			headers: { Authorization: 'Bearer invalid-token' },
		});
		const { provider } = createManifestProvider(auth, request);
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow(
			'Authentication failed',
		);
	});

	it('checks the source /mcp endpoint without dropping a composed ref base path', async () => {
		const auth = new CompositionAuth();
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				text: () => Promise.resolve('{"some":"unexpected"}'),
			})
			.mockResolvedValueOnce({
				status: 401,
			});
		vi.stubGlobal('fetch', mockFetch);

		const { provider } = createManifestProvider(auth);
		const request = new Request('http://localhost:6006/mcp');
		const source = {
			id: 'remote',
			title: 'Remote',
			url: 'https://host.example.com/storybook',
		};

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow(
			'Authentication failed',
		);
		expect(mockFetch).toHaveBeenNthCalledWith(
			2,
			'https://host.example.com/storybook/mcp',
			expect.any(Object),
		);
	});

	it('throws when response is invalid manifest and /mcp does not return 401', async () => {
		const auth = new CompositionAuth();

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					text: () => Promise.resolve('{"some":"unexpected"}'),
				})
				.mockResolvedValueOnce({
					status: 200,
				}),
		);

		const { provider } = createManifestProvider(auth);
		const request = new Request('http://localhost:6006/mcp');
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow(
			'Invalid manifest response',
		);
	});

	it('caches remote manifest responses and revalidates in background', async () => {
		const auth = new CompositionAuth();
		const manifestJson =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button"}}}';

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(manifestJson),
		});
		vi.stubGlobal('fetch', mockFetch);

		const request = new Request('http://localhost:6006/mcp', {
			headers: { Authorization: 'Bearer token' },
		});
		const { provider } = createManifestProvider(auth, request);
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await provider(request, './manifests/components.json', source);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		const result = await provider(request, './manifests/components.json', source);
		expect(result).toBe(manifestJson);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('fetches fresh when cache is expired', async () => {
		vi.useFakeTimers();
		const auth = new CompositionAuth();
		const oldManifest =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button"}}}';
		const newManifest =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button","description":"updated"}}}';

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(oldManifest) })
			.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(newManifest) });
		vi.stubGlobal('fetch', mockFetch);

		const request = new Request('http://localhost:6006/mcp', {
			headers: { Authorization: 'Bearer token' },
		});
		const { provider } = createManifestProvider(auth, request);
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		const first = await provider(request, './manifests/components.json', source);
		expect(first).toBe(oldManifest);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(61 * 60 * 1000);

		const second = await provider(request, './manifests/components.json', source);
		expect(second).toBe(newManifest);
		expect(mockFetch).toHaveBeenCalledTimes(2);

		vi.useRealTimers();
	});

	it('does not cache local manifest responses', async () => {
		const auth = new CompositionAuth();
		const manifestJson =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button"}}}';

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(manifestJson),
		});
		vi.stubGlobal('fetch', mockFetch);

		const { provider } = createManifestProvider(auth);
		const request = new Request('http://localhost:6006/mcp');

		await provider(request, './manifests/components.json');
		await provider(request, './manifests/components.json');
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('does not cache error responses', async () => {
		const auth = new CompositionAuth();
		const manifestJson =
			'{"v":1,"components":{"button":{"id":"button","path":"src/Button.tsx","name":"Button"}}}';

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockResolvedValueOnce({
				ok: true,
				text: () => Promise.resolve(manifestJson),
			});
		vi.stubGlobal('fetch', mockFetch);

		const request = new Request('http://localhost:6006/mcp', {
			headers: { Authorization: 'Bearer token' },
		});
		const { provider } = createManifestProvider(auth, request);
		const source = { id: 'remote', title: 'Remote', url: 'http://remote.example.com' };

		await expect(provider(request, './manifests/components.json', source)).rejects.toThrow();

		const result = await provider(request, './manifests/components.json', source);
		expect(result).toBe(manifestJson);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
});
