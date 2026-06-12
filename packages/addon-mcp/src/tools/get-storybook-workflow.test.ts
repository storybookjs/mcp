import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import { addGetStorybookWorkflowTool } from './get-storybook-workflow.ts';
import type { AddonContext } from '../types.ts';
import type { ToolAvailability } from '../utils/get-tool-availability.ts';
import { GET_STORYBOOK_WORKFLOW_TOOL_NAME } from './tool-names.ts';

const fullAvailability: ToolAvailability = {
	moduleGraphSupported: true,
	changeDetectionEnabled: true,
	reviewEnabled: true,
	docsEnabled: true,
	docsHasManifests: true,
	docsFeatureEnabled: true,
	testSupported: true,
	a11yEnabled: false,
};

describe('getStorybookWorkflowTool', () => {
	let server: McpServer<any, AddonContext>;

	async function setupServer(availability: ToolAvailability) {
		server = new McpServer(
			{
				name: 'test-server',
				version: '1.0.0',
				description: 'Test server for get-storybook-workflow tool',
			},
			{
				adapter: new ValibotJsonSchemaAdapter(),
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

		await addGetStorybookWorkflowTool(server, availability);
	}

	async function callTool(context: Partial<AddonContext>) {
		const response = await server.receive(
			{
				jsonrpc: '2.0' as const,
				id: 2,
				method: 'tools/call',
				params: {
					name: GET_STORYBOOK_WORKFLOW_TOOL_NAME,
					arguments: {},
				},
			},
			{
				sessionId: 'test-session',
				custom: {
					origin: 'http://localhost:6006',
					disableTelemetry: true,
					...context,
				} as AddonContext,
			},
		);
		return response.result?.content[0].text as string;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should be listed regardless of toolset configuration', async () => {
		await setupServer(fullAvailability);

		const response = await server.receive(
			{
				jsonrpc: '2.0' as const,
				id: 3,
				method: 'tools/list',
				params: {},
			},
			{
				sessionId: 'test-session',
				custom: {
					origin: 'http://localhost:6006',
					disableTelemetry: true,
					toolsets: { dev: false, docs: false, test: false },
				} as AddonContext,
			},
		);

		const tools = response.result?.tools ?? [];
		const tool = tools.find((t: any) => t.name === GET_STORYBOOK_WORKFLOW_TOOL_NAME);
		expect(tool).toBeDefined();
		expect(tool.description).toContain('Storybook MCP tools to call');
	});

	it('should return all workflow sections when everything is enabled', async () => {
		await setupServer(fullAvailability);

		const text = await callTool({ toolsets: { dev: true, docs: true, test: true } });

		expect(text).toContain('Follow these workflows when working with UI and/or Storybook.');
		expect(text).toContain('get-changed-stories');
		expect(text).toContain('preview-stories');
		expect(text).toContain('run-story-tests');
	});

	it('should omit sections for disabled toolsets', async () => {
		await setupServer(fullAvailability);

		const text = await callTool({ toolsets: { dev: true, docs: false, test: false } });

		expect(text).toContain('preview-stories');
		expect(text).not.toContain('run-story-tests');
	});

	it('should omit the test section when addon-vitest is unavailable', async () => {
		await setupServer({ ...fullAvailability, testSupported: false });

		const text = await callTool({ toolsets: { dev: true, docs: true, test: true } });

		expect(text).toContain('preview-stories');
		expect(text).not.toContain('run-story-tests');
	});

	it('should explain why no workflows are available when everything is disabled', async () => {
		await setupServer({ ...fullAvailability, testSupported: false, docsEnabled: false });

		const text = await callTool({ toolsets: { dev: false, docs: true, test: true } });

		expect(text).toContain('No Storybook workflows are currently available');
		expect(text).toContain('the `dev` toolset is disabled');
		expect(text).toContain('`@storybook/addon-vitest` is not installed');
		expect(text).toContain('no component manifest is available');
	});

	it('should explain disabled toolsets in the empty case', async () => {
		await setupServer(fullAvailability);

		const text = await callTool({ toolsets: { dev: false, docs: false, test: false } });

		expect(text).toContain('No Storybook workflows are currently available');
		expect(text).toContain('the `dev` toolset is disabled');
		expect(text).toContain('the `test` toolset is disabled');
		expect(text).toContain('the `docs` toolset is disabled');
	});

	it('should collect telemetry when enabled', async () => {
		const { telemetry } = await import('storybook/internal/telemetry');

		await setupServer(fullAvailability);
		await callTool({
			disableTelemetry: false,
			toolsets: { dev: true, docs: true, test: true },
		});

		expect(telemetry).toHaveBeenCalledWith(
			'addon-mcp',
			expect.objectContaining({
				event: 'tool:getStorybookWorkflow',
				mcpSessionId: 'test-session',
			}),
		);
	});
});
