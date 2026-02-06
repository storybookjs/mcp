import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { x } from 'tinyexec';

const STORYBOOK_DIR = new URL('..', import.meta.url).pathname;
const PORT = 6008;
const MCP_ENDPOINT = `http://localhost:${PORT}/mcp`;
const WELL_KNOWN_ENDPOINT = `http://localhost:${PORT}/.well-known/oauth-protected-resource`;
const STARTUP_TIMEOUT = 120_000;

let storybookProcess: ReturnType<typeof x> | null = null;

/**
 * Helper to create MCP protocol requests
 */
function createMCPRequestBody(method: string, params: any = {}, id: number = 1) {
	return {
		jsonrpc: '2.0',
		id,
		method,
		params,
	};
}

/**
 * Helper to make MCP requests (with optional auth token)
 */
async function mcpRequest(method: string, params: any = {}, token?: string) {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const response = await fetch(MCP_ENDPOINT, {
		method: 'POST',
		headers,
		body: JSON.stringify(createMCPRequestBody(method, params)),
	});

	return response;
}

/**
 * Parse MCP response from SSE format
 */
async function parseMCPResponse(response: Response) {
	const text = await response.text();
	const jsonText = text.replace(/^data: /, '').trim();
	return JSON.parse(jsonText);
}

/**
 * Wait for MCP endpoint to be ready by polling it directly.
 * For auth-required endpoints, a 401 also means the server is up.
 */
async function waitForMcpEndpoint(maxAttempts = 120, interval = 500): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	let attempts = 0;

	const intervalId = setInterval(async () => {
		attempts++;
		try {
			const response = await fetch(MCP_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(createMCPRequestBody('tools/list')),
			});
			// Both 200 (no auth) and 401 (auth required) mean the server is up
			if (response.ok || response.status === 401) {
				clearInterval(intervalId);
				resolve();
				return;
			}
		} catch {
			// Server not ready yet
		}

		if (attempts >= maxAttempts) {
			clearInterval(intervalId);
			reject(new Error('MCP endpoint failed to start within the timeout period'));
		}
	}, interval);

	return promise;
}

describe('MCP Composition Auth E2E Tests', () => {
	beforeAll(async () => {
		// Kill any existing process on the port
		try {
			if (process.platform === 'win32') {
				await x('npx', ['kill-port', String(PORT)]);
			} else {
				const { stdout } = await x('lsof', ['-ti', `:${PORT}`]);
				if (stdout.trim()) {
					await x('kill', ['-9', ...stdout.trim().split('\n')]);
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} catch {
			// No process on port, continue
		}

		// Start Storybook with composition-auth config
		storybookProcess = x(
			'pnpm',
			['storybook', '--config-dir', '.storybook-composition-auth', '--port', String(PORT)],
			{
				nodeOptions: {
					cwd: STORYBOOK_DIR,
				},
			},
		);

		// Wait for MCP endpoint to be ready
		await waitForMcpEndpoint();
	}, STARTUP_TIMEOUT);

	afterAll(async () => {
		if (!storybookProcess || !storybookProcess.process) {
			return;
		}
		const kill = Promise.withResolvers<void>();
		storybookProcess.process.on('exit', kill.resolve);
		storybookProcess.kill('SIGTERM');
		await kill.promise;
		storybookProcess = null;
	});

	describe('OAuth Discovery', () => {
		it('should expose .well-known/oauth-protected-resource for private refs', async () => {
			const response = await fetch(WELL_KNOWN_ENDPOINT);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('application/json');

			const metadata = await response.json();
			expect(metadata).toHaveProperty('resource');
			expect(metadata).toHaveProperty('authorization_servers');
			expect(metadata.resource).toContain('/mcp');
			expect(metadata.authorization_servers).toBeInstanceOf(Array);
			expect(metadata.authorization_servers.length).toBeGreaterThan(0);
		});

		it('should point resource to the local MCP endpoint', async () => {
			const response = await fetch(WELL_KNOWN_ENDPOINT);
			const metadata = await response.json();

			expect(metadata.resource).toBe(`http://localhost:${PORT}/mcp`);
		});
	});

	describe('Auth Gate', () => {
		it('should return 401 without Bearer token', async () => {
			const response = await mcpRequest('tools/list');

			expect(response.status).toBe(401);
		});

		it('should include WWW-Authenticate header in 401 response', async () => {
			const response = await mcpRequest('tools/list');

			expect(response.status).toBe(401);
			const wwwAuth = response.headers.get('www-authenticate');
			expect(wwwAuth).toBeTruthy();
			expect(wwwAuth).toContain('Bearer');
			expect(wwwAuth).toContain('resource_metadata');
			expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
		});

		it('should reject requests without valid token', async () => {
			const response = await mcpRequest('tools/list', {}, 'invalid-token');

			// With an invalid token, the server accepts the request (token is present)
			// but the remote source will fail to fetch
			expect(response.status).toBe(200);
		});
	});

	describe('Multi-Source with Auth', () => {
		it('should list tools with storybookId parameter when authenticated', async () => {
			// Use a dummy token — the local source should still work
			const response = await mcpRequest('tools/list', {}, 'dummy-token');
			const data = await parseMCPResponse(response);

			const getDocTool = data.result.tools.find((t: any) => t.name === 'get-documentation');

			expect(getDocTool).toBeDefined();
			expect(getDocTool.inputSchema.properties).toHaveProperty('storybookId');
		});

		it('should list local documentation with a token', async () => {
			const response = await mcpRequest(
				'tools/call',
				{ name: 'list-all-documentation', arguments: {} },
				'dummy-token',
			);
			const data = await parseMCPResponse(response);

			const text = data.result.content[0].text;

			// Local source should always work
			expect(text).toContain('Local');
			expect(text).toContain('id: local');
			expect(text).toContain('Button');
		});

		it('should show authentication error for remote source with invalid token', async () => {
			const response = await mcpRequest(
				'tools/call',
				{ name: 'list-all-documentation', arguments: {} },
				'dummy-token',
			);
			const data = await parseMCPResponse(response);

			const text = data.result.content[0].text;

			// Remote source should show an auth error (invalid token triggers /mcp 401 check)
			expect(text).toContain('test-private-sb');
			expect(text).toContain('Authentication failed');
		});

		it('should fetch local component documentation with storybookId', async () => {
			const response = await mcpRequest(
				'tools/call',
				{
					name: 'get-documentation',
					arguments: { id: 'example-button', storybookId: 'local' },
				},
				'dummy-token',
			);
			const data = await parseMCPResponse(response);

			expect(data.result.content[0].type).toBe('text');
			const text = data.result.content[0].text;
			expect(text).toContain('Button');
		});

		it('should require storybookId in multi-source auth mode', async () => {
			const response = await mcpRequest(
				'tools/call',
				{
					name: 'get-documentation',
					arguments: { id: 'example-button' },
				},
				'dummy-token',
			);
			const data = await parseMCPResponse(response);

			expect(data.result).toHaveProperty('isError', true);
			expect(data.result.content[0].text).toContain('storybookId is required');
		});
	});
});
