import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Options } from 'storybook/internal/types';
import { experimental_devServer } from './preset.ts';
import * as runStoryTests from './tools/run-story-tests.ts';

describe('experimental_devServer', () => {
	let mockApp: any;
	let mockOptions: Options;
	let mcpHandler: any;

	beforeEach(() => {
		mockApp = {
			post: vi.fn((path, handler) => {
				mcpHandler = handler;
			}),
			get: vi.fn(),
		};

		mockOptions = {
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;
	});

	it('should register /mcp POST endpoint', async () => {
		await (experimental_devServer as any)(mockApp, mockOptions);

		expect(mockApp.post).toHaveBeenCalledWith('/mcp', expect.any(Function));
		expect(mcpHandler).toBeDefined();
	});

	it('should register /mcp GET endpoint', async () => {
		await (experimental_devServer as any)(mockApp, mockOptions);

		expect(mockApp.get).toHaveBeenCalledWith('/mcp', expect.any(Function));
	});

	it('should serve HTML for browser GET requests', async () => {
		let getHandler: any;
		mockApp.get = vi.fn((path, handler) => {
			getHandler = handler;
		});

		await (experimental_devServer as any)(mockApp, mockOptions);

		const mockReq = {
			headers: {
				accept: 'text/html',
			},
		} as any;

		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		} as any;

		await getHandler(mockReq, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
			'Content-Type': 'text/html',
		});
		expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('<html'));
	});

	it('should show docs enabled for composed refs without showing local manifest warnings', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: () =>
					Promise.resolve(
						JSON.stringify({
							v: 1,
							components: {
								button: {
									id: 'button',
									path: 'src/Button.tsx',
									name: 'Button',
								},
							},
						}),
					),
			}),
		);

		const handlers: Record<string, any> = {};
		mockApp.get = vi.fn((path: string, handler: any) => {
			handlers[path] = handler;
		});

		const optionsWithRemoteRef = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') {
						return Promise.resolve({
							remote: { title: 'Remote', url: 'https://remote.example.com' },
						});
					}
					if (key === 'features') {
						return Promise.resolve({});
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, optionsWithRemoteRef);

		const mockReq = {
			headers: {
				accept: 'text/html',
			},
		} as any;
		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		} as any;

		await handlers['/mcp'](mockReq, mockRes);

		const html = mockRes.end.mock.calls[0][0];
		expect(html).toMatch(
			/<span>docs<\/span>\s*<span class="toolset-status enabled">enabled<\/span>/,
		);
		expect(html).not.toContain('This toolset is only supported in React-based setups.');
		expect(html).not.toContain('This toolset requires enabling the component manifest feature.');
	});

	it('should show Storybook version requirement for addon-vitest and a manual manifest link', async () => {
		vi.spyOn(runStoryTests, 'getAddonVitestConstants').mockResolvedValue(undefined);
		const manifestEnabledOptions = {
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'features') {
						return Promise.resolve({ experimentalComponentsManifest: true });
					}
					if (key === 'experimental_manifests') {
						return Promise.resolve({ components: { v: 1, components: {} } });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		const handlers: Record<string, any> = {};
		mockApp.get = vi.fn((path: string, handler: any) => {
			handlers[path] = handler;
		});

		await (experimental_devServer as any)(mockApp, manifestEnabledOptions);
		const getMcpHandler = handlers['/mcp'];
		expect(getMcpHandler).toBeDefined();

		const mockReq = {
			headers: {
				accept: 'text/html',
			},
		} as any;
		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		} as any;

		await getMcpHandler(mockReq, mockRes);

		expect(mockRes.end).toHaveBeenCalledWith(
			expect.stringContaining('This toolset requires Storybook 10.3.0+ with'),
		);
		expect(mockRes.end).toHaveBeenCalledWith(
			expect.stringContaining(
				'View the <a href="/manifests/components.html">component manifest debugger</a>.',
			),
		);
	});

	it('should handle POST requests as MCP protocol', async () => {
		await (experimental_devServer as any)(mockApp, mockOptions);

		const initializeRequest = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {
					name: 'test-client',
					version: '1.0.0',
				},
			},
		});

		const mockReq = {
			method: 'POST',
			headers: {
				accept: 'text/html',
				'content-type': 'application/json',
				host: 'localhost:6006',
			},
			socket: { encrypted: false },
			url: '/',
			[Symbol.asyncIterator]: async function* () {
				yield Buffer.from(initializeRequest);
			},
		} as any;

		const mockRes = {
			writeHead: vi.fn(),
			write: vi.fn(),
			end: vi.fn(),
			setHeader: vi.fn(),
			statusCode: 0,
		} as any;

		await mcpHandler(mockReq, mockRes);

		expect(mockRes.writeHead).not.toHaveBeenCalledWith(200, {
			'Content-Type': 'text/html',
		});
		expect(mockRes.end).not.toHaveBeenCalledWith(expect.stringContaining('<html'));
	});

	it('should return the app instance', async () => {
		const result = await (experimental_devServer as any)(mockApp, mockOptions);
		expect(result).toBe(mockApp);
	});

	it('should handle partial toolsets configuration', async () => {
		const partialOptions = {
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
			toolsets: {
				dev: false,
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, partialOptions);

		expect(mockApp.post).toHaveBeenCalledWith('/mcp', expect.any(Function));
		expect(mockApp.get).toHaveBeenCalledWith('/mcp', expect.any(Function));
	});

	it('should register .well-known endpoint that returns 404 when no auth required', async () => {
		const handlers: Record<string, any> = {};
		mockApp.get = vi.fn((path: string, handler: any) => {
			handlers[path] = handler;
		});

		await (experimental_devServer as any)(mockApp, mockOptions);

		const wellKnownHandler = handlers['/.well-known/oauth-protected-resource'];
		expect(wellKnownHandler).toBeDefined();

		const mockRes = { writeHead: vi.fn(), end: vi.fn() } as any;
		wellKnownHandler({}, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(404);
		expect(mockRes.end).toHaveBeenCalledWith('Not found');
	});

	it('should challenge regular requests when composed refs require auth', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					status: 401,
					headers: new Headers({
						'WWW-Authenticate':
							'Bearer resource_metadata="https://remote.example.com/.well-known/oauth-protected-resource"',
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							resource: 'https://remote.example.com/mcp',
							authorization_servers: ['https://auth.example.com'],
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							issuer: 'https://auth.example.com',
							authorization_endpoint: 'https://auth.example.com/authorize',
							token_endpoint: 'https://auth.example.com/token',
						}),
				}),
		);

		const optionsWithPrivateRef = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') {
						return Promise.resolve({
							private: { title: 'Private', url: 'https://remote.example.com' },
						});
					}
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, optionsWithPrivateRef);

		const mockReq = { headers: {} } as any;
		const mockRes = { writeHead: vi.fn(), end: vi.fn() } as any;
		await mcpHandler(mockReq, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(
			401,
			expect.objectContaining({
				'WWW-Authenticate': expect.stringContaining('resource_metadata='),
			}),
		);
		expect(mockRes.end).toHaveBeenCalledWith('401 - Unauthorized');
	});

	it('should allow Storybook MCP proxy requests when composed refs require auth', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					status: 401,
					headers: new Headers({
						'WWW-Authenticate':
							'Bearer resource_metadata="https://remote.example.com/.well-known/oauth-protected-resource"',
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							resource: 'https://remote.example.com/mcp',
							authorization_servers: ['https://auth.example.com'],
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							issuer: 'https://auth.example.com',
							authorization_endpoint: 'https://auth.example.com/authorize',
							token_endpoint: 'https://auth.example.com/token',
						}),
				}),
		);

		const optionsWithPrivateRef = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') {
						return Promise.resolve({
							private: { title: 'Private', url: 'https://remote.example.com' },
						});
					}
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, optionsWithPrivateRef);

		const initializeRequest = JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: {
					name: 'test-client',
					version: '1.0.0',
				},
			},
		});
		const mockReq = {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				host: 'localhost:6006',
				'x-storybook-mcp-proxy': 'true',
			},
			socket: { encrypted: false, remoteAddress: '127.0.0.1' },
			url: '/mcp',
			[Symbol.asyncIterator]: async function* () {
				yield Buffer.from(initializeRequest);
			},
		} as any;
		const mockRes = {
			writeHead: vi.fn(),
			write: vi.fn(),
			end: vi.fn(),
			setHeader: vi.fn(),
			statusCode: 0,
		} as any;

		await mcpHandler(mockReq, mockRes);

		expect(mockRes.writeHead).not.toHaveBeenCalledWith(
			401,
			expect.objectContaining({ 'WWW-Authenticate': expect.any(String) }),
		);
		expect(mockRes.end).toHaveBeenCalled();
	});

	it('should challenge spoofed Storybook MCP proxy requests from non-loopback clients', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					status: 401,
					headers: new Headers({
						'WWW-Authenticate':
							'Bearer resource_metadata="https://remote.example.com/.well-known/oauth-protected-resource"',
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							resource: 'https://remote.example.com/mcp',
							authorization_servers: ['https://auth.example.com'],
						}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							issuer: 'https://auth.example.com',
							authorization_endpoint: 'https://auth.example.com/authorize',
							token_endpoint: 'https://auth.example.com/token',
						}),
				}),
		);

		const optionsWithPrivateRef = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') {
						return Promise.resolve({
							private: { title: 'Private', url: 'https://remote.example.com' },
						});
					}
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, optionsWithPrivateRef);

		const mockReq = {
			headers: {
				'x-storybook-mcp-proxy': 'true',
			},
			socket: { remoteAddress: '10.0.0.5' },
		} as any;
		const mockRes = { writeHead: vi.fn(), end: vi.fn() } as any;
		await mcpHandler(mockReq, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(
			401,
			expect.objectContaining({
				'WWW-Authenticate': expect.stringContaining('resource_metadata='),
			}),
		);
		expect(mockRes.end).toHaveBeenCalledWith('401 - Unauthorized');
	});

	it('should forward non-HTML GET /mcp requests to MCP handler', async () => {
		const handlers: Record<string, any> = {};
		mockApp.get = vi.fn((path: string, handler: any) => {
			handlers[path] = handler;
		});

		await (experimental_devServer as any)(mockApp, mockOptions);

		const getMcpHandler = handlers['/mcp'];
		expect(getMcpHandler).toBeDefined();

		// Non-HTML request (JSON accept) — uses POST method since GET can't have body
		const mockReq = {
			method: 'POST',
			headers: { accept: 'application/json', host: 'localhost:6006' },
			socket: { encrypted: false },
			url: '/mcp',
			[Symbol.asyncIterator]: async function* () {
				yield Buffer.from(
					JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'initialize',
						params: {
							protocolVersion: '2024-11-05',
							capabilities: {},
							clientInfo: { name: 'test', version: '1.0.0' },
						},
					}),
				);
			},
		} as any;

		const mockRes = {
			writeHead: vi.fn(),
			write: vi.fn(),
			end: vi.fn(),
			setHeader: vi.fn(),
			statusCode: 0,
		} as any;

		await getMcpHandler(mockReq, mockRes);

		// Should NOT serve HTML — goes through MCP handler instead
		expect(mockRes.writeHead).not.toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
	});

	it('should parse refs from storybook config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				headers: new Headers(),
			}),
		);

		const apply = vi.fn((key: string) => {
			if (key === 'refs') {
				return Promise.resolve({
					'my-lib': { title: 'My Library', url: 'https://my-lib.example.com' },
					'design-system': { url: 'https://ds.example.com' },
				});
			}
			if (key === 'features') {
				return Promise.resolve({ componentsManifest: false });
			}
			return Promise.resolve(undefined);
		});
		const optionsWithRefs = {
			port: 6006,
			presets: {
				apply,
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, optionsWithRefs);

		// The preset should have called presets.apply('refs')
		expect(apply).toHaveBeenCalledWith('refs', {});
	});

	it('should handle refs config returning non-object gracefully', async () => {
		const optionsWithBadRefs = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') return Promise.resolve(null);
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		// Should not throw
		const result = await (experimental_devServer as any)(mockApp, optionsWithBadRefs);
		expect(result).toBe(mockApp);
	});

	it('should handle refs config throwing gracefully', async () => {
		const optionsWithThrowingRefs = {
			port: 6006,
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'refs') return Promise.reject(new Error('Config error'));
					if (key === 'features') {
						return Promise.resolve({ componentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;

		// Should not throw
		const result = await (experimental_devServer as any)(mockApp, optionsWithThrowingRefs);
		expect(result).toBe(mockApp);
	});
});
