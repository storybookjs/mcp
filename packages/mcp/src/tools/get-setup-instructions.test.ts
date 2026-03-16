import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from 'tmcp';
import { ValibotJsonSchemaAdapter } from '@tmcp/adapter-valibot';
import {
	addGetSetupInstructionsTool,
	GET_SETUP_INSTRUCTIONS_TOOL_NAME,
} from './get-setup-instructions.ts';
import type { StorybookContext } from '../types.ts';
import smallManifestFixture from '../../fixtures/small-manifest.fixture.json' with { type: 'json' };
import smallDocsManifestFixture from '../../fixtures/small-docs-manifest.fixture.json' with { type: 'json' };
import * as getManifest from '../utils/get-manifest.ts';

describe('getSetupInstructionsTool', () => {
	let server: McpServer<any, StorybookContext>;
	let getManifestsSpy: any;
	let getMultiSourceManifestsSpy: any;

	beforeEach(async () => {
		const adapter = new ValibotJsonSchemaAdapter();
		server = new McpServer(
			{
				name: 'test-server',
				version: '1.0.0',
				description: 'Test server for setup instructions tool',
			},
			{
				adapter,
				capabilities: {
					tools: { listChanged: true },
				},
			},
		).withContext<StorybookContext>();

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
			{ sessionId: 'test-session' },
		);

		await addGetSetupInstructionsTool(server);

		getManifestsSpy = vi.spyOn(getManifest, 'getManifests');
		getMultiSourceManifestsSpy = vi.spyOn(getManifest, 'getMultiSourceManifests');
		getManifestsSpy.mockResolvedValue({
			componentManifest: smallManifestFixture,
			docsManifest: smallDocsManifestFixture,
		});
	});

	it('should return the tagged setup instructions docs entry', async () => {
		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
				arguments: {},
			},
		};

		const mockHttpRequest = new Request('https://example.com/mcp');
		const response = await server.receive(request, {
			custom: { request: mockHttpRequest },
		});

		expect(response.result).toMatchInlineSnapshot(`
			{
			  "content": [
			    {
			      "text": "# Getting Started Guide

			# Getting Started

			Welcome to the component library. This guide will help you get up and running.

			## Installation

			\`\`\`bash
			npm install my-component-library
			\`\`\`

			## Usage

			Import components and use them in your application.",
			      "type": "text",
			    },
			  ],
			}
		`);
	});

	it('should return an error when no tagged setup instructions docs entry exists', async () => {
		getManifestsSpy.mockResolvedValue({
			componentManifest: smallManifestFixture,
			docsManifest: {
				v: 1,
				docs: {
					theming: {
						...smallDocsManifestFixture.docs.theming,
					},
				},
			},
		});

		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
				arguments: {},
			},
		};

		const mockHttpRequest = new Request('https://example.com/mcp');
		const response = await server.receive(request, {
			custom: { request: mockHttpRequest },
		});

		expect(response.result).toMatchInlineSnapshot(`
			{
			  "content": [
			    {
			      "text": "Setup instructions not found. This Storybook does not expose a docs entry tagged "setup-instructions". Use the list-all-documentation tool to inspect available documentation entries, and use get-documentation for component APIs and usage examples.",
			      "type": "text",
			    },
			  ],
			  "isError": true,
			}
		`);
	});

	it('should support source selection in multi-source mode', async () => {
		const sources = [
			{ id: 'local', title: 'Local' },
			{ id: 'remote', title: 'Remote', url: 'http://remote.example.com' },
		];

		const adapter = new ValibotJsonSchemaAdapter();
		server = new McpServer(
			{
				name: 'test-server',
				version: '1.0.0',
				description: 'Test server for setup instructions tool',
			},
			{
				adapter,
				capabilities: {
					tools: { listChanged: true },
				},
			},
		).withContext<StorybookContext>();

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
			{ sessionId: 'test-session' },
		);

		await addGetSetupInstructionsTool(server, undefined, { multiSource: true });
		getManifestsSpy.mockResolvedValue({
			componentManifest: smallManifestFixture,
			docsManifest: smallDocsManifestFixture,
		});

		const request = {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'tools/call',
			params: {
				name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
				arguments: { storybookId: 'remote' },
			},
		};

		const mockHttpRequest = new Request('https://example.com/mcp');
		const response = await server.receive(request, {
			custom: { request: mockHttpRequest, sources },
		});

		expect((response.result as any).content[0].text).toContain('# Getting Started Guide');
		expect(getManifestsSpy).toHaveBeenCalledWith(mockHttpRequest, undefined, sources[1]);
	});

	it('should be hidden from tools/list when no setup instructions docs entry exists', async () => {
		getManifestsSpy.mockResolvedValue({
			componentManifest: smallManifestFixture,
			docsManifest: {
				v: 1,
				docs: {
					theming: {
						...smallDocsManifestFixture.docs.theming,
					},
				},
			},
		});

		const request = {
			jsonrpc: '2.0' as const,
			id: 2,
			method: 'tools/list',
			params: {},
		};

		const mockHttpRequest = new Request('https://example.com/mcp');
		const response = await server.receive(request, {
			custom: { request: mockHttpRequest },
		});

		expect((response.result as any).tools).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
				}),
			]),
		);
	});

	it('should be listed when at least one source exposes tagged setup instructions', async () => {
		const sources = [
			{ id: 'local', title: 'Local' },
			{ id: 'remote', title: 'Remote', url: 'http://remote.example.com' },
		];

		getMultiSourceManifestsSpy.mockResolvedValue([
			{
				source: sources[0]!,
				componentManifest: smallManifestFixture,
				docsManifest: {
					v: 1,
					docs: {
						theming: {
							...smallDocsManifestFixture.docs.theming,
						},
					},
				},
			},
			{
				source: sources[1]!,
				componentManifest: smallManifestFixture,
				docsManifest: smallDocsManifestFixture,
			},
		]);

		const request = {
			jsonrpc: '2.0' as const,
			id: 3,
			method: 'tools/list',
			params: {},
		};

		const mockHttpRequest = new Request('https://example.com/mcp');
		const response = await server.receive(request, {
			custom: { request: mockHttpRequest, sources },
		});

		expect((response.result as any).tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
				}),
			]),
		);
	});
});
