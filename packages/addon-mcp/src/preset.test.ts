import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Options } from 'storybook/internal/types';
import { experimental_devServer } from './preset.ts';

describe('experimental_devServer', () => {
	let mockApp: any;
	let mockOptions: Options;
	let mcpHandler: any;

	beforeEach(() => {
		mockApp = {
			use: vi.fn((path, handler) => {
				mcpHandler = handler;
			}),
		};

		mockOptions = {
			presets: {
				apply: vi.fn((key: string) => {
					if (key === 'features') {
						return Promise.resolve({ experimentalComponentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
		} as unknown as Options;
	});

	it('should register /mcp endpoint', async () => {
		await (experimental_devServer as any)(mockApp, mockOptions);

		expect(mockApp.use).toHaveBeenCalledWith('/mcp', expect.any(Function));
		expect(mcpHandler).toBeDefined();
	});

	it('should serve HTML for browser GET requests', async () => {
		await (experimental_devServer as any)(mockApp, mockOptions);

		const mockReq = {
			method: 'GET',
			headers: {
				accept: 'text/html',
			},
		} as any;

		const mockRes = {
			writeHead: vi.fn(),
			end: vi.fn(),
		} as any;

		await mcpHandler(mockReq, mockRes);

		expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
			'Content-Type': 'text/html',
		});
		expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('<html'));
	});

	it('should not serve HTML for POST requests', async () => {
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
			},
			socket: {},
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
		expect(mockRes.end).not.toHaveBeenCalledWith(
			expect.stringContaining('<html'),
		);
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
						return Promise.resolve({ experimentalComponentsManifest: false });
					}
					return Promise.resolve(undefined);
				}),
			},
			toolsets: {
				dev: false,
			},
		} as unknown as Options;

		await (experimental_devServer as any)(mockApp, partialOptions);

		expect(mockApp.use).toHaveBeenCalledWith('/mcp', expect.any(Function));
	});
});
