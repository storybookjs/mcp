import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { addScreenshotStoryTool } from './screenshot-story.ts';
import type { AddonContext } from '../types.ts';
import smallStoryIndexFixture from '../../fixtures/small-story-index.fixture.json' with { type: 'json' };
import * as fetchStoryIndex from '../utils/fetch-story-index.ts';
import { SCREENSHOT_STORY_TOOL_NAME } from './tool-names.ts';

vi.mock('storybook/internal/csf', () => ({
	storyNameFromExport: (exportName: string) => exportName,
}));

vi.mock('../utils/browser-manager.ts', () => ({
	isPlaywrightAvailable: vi.fn().mockResolvedValue(true),
	takeScreenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png-data')),
}));

const mockScreenshotBuffer = Buffer.from('fake-png-data');

describe('screenshotStoryTool', () => {
	let server: McpServer<any, AddonContext>;
	let fetchStoryIndexSpy: any;
	let takeScreenshotSpy: any;
	const testContext: AddonContext = {
		origin: 'http://localhost:6006',
		options: {} as any,
		disableTelemetry: true,
	};

	beforeEach(async () => {
		const { takeScreenshot } = await import('../utils/browser-manager.ts');
		takeScreenshotSpy = takeScreenshot;

		const adapter = new ValibotJsonSchemaAdapter();
		server = new McpServer(
			{
				name: 'test-server',
				version: '1.0.0',
				description: 'Test server for screenshot-story tool',
			},
			{
				adapter,
				capabilities: {
					tools: { listChanged: true },
				},
			},
		).withContext<AddonContext>();

		await server.receive(
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-06-18',
					capabilities: {},
					clientInfo: { name: 'test', version: '1.0.0' },
				},
			},
			{
				sessionId: 'test-session',
			},
		);

		await addScreenshotStoryTool(server);

		fetchStoryIndexSpy = vi.spyOn(fetchStoryIndex, 'fetchStoryIndex');
		fetchStoryIndexSpy.mockResolvedValue(smallStoryIndexFixture);
	});

	it('should return a screenshot for a valid storyId', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: { storyId: 'button--primary' },
				},
			},
		};

		const response = await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(response.result?.content).toEqual([
			{
				type: 'image',
				data: mockScreenshotBuffer.toString('base64'),
				mimeType: 'image/png',
			},
			{
				type: 'text',
				text: 'Screenshot of story "Button / Primary" (button--primary)',
			},
		]);

		expect(takeScreenshotSpy).toHaveBeenCalledWith({
			url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
			viewport: undefined,
			omitBackground: undefined,
			fullPage: undefined,
		});
	});

	it('should return a screenshot for a valid path-based input', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: {
						exportName: 'Primary',
						absoluteStoryPath: `${process.cwd()}/src/Button.stories.tsx`,
					},
				},
			},
		};

		const response = await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(response.result?.content[0]).toEqual({
			type: 'image',
			data: mockScreenshotBuffer.toString('base64'),
			mimeType: 'image/png',
		});
		expect(response.result?.content[1]).toEqual({
			type: 'text',
			text: 'Screenshot of story "Button / Primary" (button--primary)',
		});
	});

	it('should pass custom props as args in the iframe URL', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: {
						storyId: 'button--primary',
						props: { label: 'Custom Label', disabled: true },
					},
				},
			},
		};

		await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(takeScreenshotSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story&args=label:Custom+Label;disabled:!true',
			}),
		);
	});

	it('should pass globals in the iframe URL', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: {
						storyId: 'button--primary',
						globals: { theme: 'dark' },
					},
				},
			},
		};

		await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(takeScreenshotSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story&globals=theme:dark',
			}),
		);
	});

	it('should pass custom viewport to takeScreenshot', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: { storyId: 'button--primary' },
					viewport: { width: 800, height: 600 },
				},
			},
		};

		await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(takeScreenshotSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				viewport: { width: 800, height: 600 },
			}),
		);
	});

	it('should return error for story not found', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: { storyId: 'nonexistent--story' },
				},
			},
		};

		const response = await server.receive(request, {
			sessionId: 'test-session',
			custom: testContext,
		});

		expect(response.result).toEqual({
			content: [
				{
					type: 'text',
					text: 'No story found for story ID "nonexistent--story"',
				},
			],
			isError: true,
		});
	});

	it('should return error when origin is missing', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: { storyId: 'button--primary' },
				},
			},
		};

		const response = await server.receive(request, {
			sessionId: 'test-session',
			custom: {
				options: {} as any,
				disableTelemetry: true,
			} as any,
		});

		expect(response.result).toEqual({
			content: [
				{
					type: 'text',
					text: 'Error: Origin is required in addon context',
				},
			],
			isError: true,
		});
	});

	it('should collect telemetry when enabled', async () => {
		const { telemetry } = await import('storybook/internal/telemetry');

		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: SCREENSHOT_STORY_TOOL_NAME,
				arguments: {
					story: { storyId: 'button--primary' },
				},
			},
		};

		await server.receive(request, {
			sessionId: 'test-session',
			custom: {
				origin: 'http://localhost:6006',
				options: {} as any,
				disableTelemetry: false,
			},
		});

		expect(telemetry).toHaveBeenCalledWith(
			'addon-mcp',
			expect.objectContaining({
				event: 'tool:screenshotStory',
				mcpSessionId: 'test-session',
				toolset: 'dev',
			}),
		);
	});
});
