import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { x } from 'tinyexec';

const STORYBOOK_DIR = new URL('..', import.meta.url).pathname;
const MCP_ENDPOINT = 'http://localhost:6007/mcp';
const STARTUP_TIMEOUT = 120_000; // Longer timeout for composition (needs to fetch remote manifests)

let storybookProcess: ReturnType<typeof x> | null = null;

/**
 * Helper to create MCP protocol requests
 */
function createMCPRequestBody(
	method: string,
	params: any = {},
	id: number = 1,
) {
	return {
		jsonrpc: '2.0',
		id,
		method,
		params,
	};
}

/**
 * Helper to make MCP requests
 */
async function mcpRequest(method: string, params: any = {}, id: number = 1) {
	const response = await fetch(MCP_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(createMCPRequestBody(method, params, id)),
	});

	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}

	// MCP responses come as SSE (Server-Sent Events) format
	const text = await response.text();
	// Remove "data: " prefix if present
	const jsonText = text.replace(/^data: /, '').trim();
	return JSON.parse(jsonText);
}

/**
 * Wait for MCP endpoint to be ready by polling it directly
 */
async function waitForMcpEndpoint(
	maxAttempts = 120,
	interval = 500,
): Promise<void> {
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
			if (response.ok) {
				clearInterval(intervalId);
				resolve();
				return;
			}
		} catch (error) {
			// Server not ready yet
		}

		if (attempts >= maxAttempts) {
			clearInterval(intervalId);
			reject(
				new Error('MCP endpoint failed to start within the timeout period'),
			);
		}
	}, interval);

	return promise;
}

describe('MCP Composition E2E Tests', () => {
	beforeAll(async () => {
		// Kill any existing process on port 6007 (cross-platform)
		try {
			if (process.platform === 'win32') {
				await x('npx', ['kill-port', '6007']);
			} else {
				// macOS and Linux: use lsof (commonly available on both)
				const { stdout } = await x('lsof', ['-ti', ':6007']);
				if (stdout.trim()) {
					await x('kill', ['-9', ...stdout.trim().split('\n')]);
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} catch {
			// No process on port, continue
		}

		// Start Storybook with composition config on port 6007
		storybookProcess = x(
			'pnpm',
			['storybook', '--config-dir', '.storybook-composition', '--port', '6007'],
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

	describe('Multi-Source Documentation', () => {
		it('should list documentation from both local and remote sources', async () => {
			const response = await mcpRequest('tools/call', {
				name: 'list-all-documentation',
				arguments: {},
			});

			const text = response.result.content[0].text;

			// Should contain Local source
			expect(text).toContain('# Local');
			expect(text).toContain('id: local');

			// Should contain remote Storybook UI source
			expect(text).toContain('# Storybook UI');
			expect(text).toContain('id: storybook-ui');

			// Local components should be present
			expect(text).toContain('Button (example-button)');

			// Remote components should be present (from storybook-ui)
			expect(text).toContain('## Components');
		});

		it('should fetch documentation for a local component', async () => {
			const response = await mcpRequest('tools/call', {
				name: 'get-documentation',
				arguments: {
					id: 'example-button',
					storybookId: 'local',
				},
			});

			expect(response.result).toHaveProperty('content');
			expect(response.result.content[0].type).toBe('text');

			const text = response.result.content[0].text;
			expect(text).toContain('# Button');
			expect(text).toContain('ID: example-button');
			expect(text).toContain('Primary UI component for user interaction');
		});

		it('should fetch documentation for a component from remote source', async () => {
			// Get documentation for a component that exists in the remote Storybook UI
			const response = await mcpRequest('tools/call', {
				name: 'get-documentation',
				arguments: {
					id: 'example-button',
					storybookId: 'storybook-ui',
				},
			});

			expect(response.result).toHaveProperty('content');
			expect(response.result.content[0].type).toBe('text');

			const text = response.result.content[0].text;
			// Should contain component documentation from remote source
			expect(text).toContain('Button');
			expect(text).toContain('example-button');
		});

		it('should require storybookId in multi-source mode', async () => {
			// Without storybookId, should get an error
			const response = await mcpRequest('tools/call', {
				name: 'get-documentation',
				arguments: {
					id: 'example-button',
				},
			});

			expect(response.result).toHaveProperty('isError', true);
			expect(response.result.content[0].text).toContain('storybookId is required');
		});
	});

	describe('Public Refs (No Auth)', () => {
		it('should not require authentication for public refs', async () => {
			// The .well-known endpoint should return "Not found" for public refs
			const response = await fetch(
				'http://localhost:6007/.well-known/oauth-protected-resource',
			);
			const text = await response.text();

			// Public refs should not expose OAuth metadata
			expect(text).toBe('Not found');
		});
	});

	describe('Tools Schema', () => {
		it('should include storybookId parameter in get-documentation schema', async () => {
			const response = await mcpRequest('tools/list');

			const getDocTool = response.result.tools.find(
				(t: any) => t.name === 'get-documentation',
			);

			expect(getDocTool).toBeDefined();
			expect(getDocTool.inputSchema.properties).toHaveProperty('storybookId');
			expect(getDocTool.inputSchema.properties.storybookId).toMatchObject({
				type: 'string',
				description: expect.stringContaining('source'),
			});
		});
	});
});
