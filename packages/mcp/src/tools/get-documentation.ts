import * as v from 'valibot';
import type { McpServer } from 'tmcp';
import type { ComponentManifest, Doc, StorybookContext } from '../types.ts';
import { getManifests, errorToMCPContent } from '../utils/get-manifest.ts';
import {
	formatComponentManifest,
	formatDocsManifest,
} from '../utils/format-manifest.ts';
import { LIST_TOOL_NAME } from './list-all-documentation.ts';

export const GET_TOOL_NAME = 'get-documentation';

const GetDocumentationInput = v.object({
	id: v.pipe(
		v.string(),
		v.description('The component or docs entry ID (e.g., "button")'),
	),
	storybookId: v.pipe(
		v.optional(v.string()),
		v.description(
			'The Storybook source ID (e.g., "local", "tetra"). Required when multiple Storybooks are composed. See list-all-documentation for available sources.',
		),
	),
});

export async function addGetDocumentationTool(
	server: McpServer<any, StorybookContext>,
	enabled?: Parameters<McpServer<any, StorybookContext>['tool']>[0]['enabled'],
) {
	server.tool(
		{
			name: GET_TOOL_NAME,
			title: 'Get Documentation',
			description:
				'Get detailed documentation for a specific UI component or docs entry',
			schema: GetDocumentationInput,
			enabled,
		},
		async (input: v.InferOutput<typeof GetDocumentationInput>) => {
			try {
				const ctx = server.ctx.custom;
				const format = ctx?.format ?? 'markdown';
				const { id, storybookId } = input;

				// Multi-source mode: when sources are configured
				if (ctx?.sources && ctx.sources.length > 0) {
					// storybookId is required in multi-source mode
					if (!storybookId) {
						const availableSources = ctx.sources.map((s) => s.id).join(', ');
						return {
							content: [
								{
									type: 'text' as const,
									text: `storybookId is required. Available sources: ${availableSources}. Use the ${LIST_TOOL_NAME} tool to see available sources.`,
								},
							],
							isError: true,
						};
					}

					// Find the requested source
					const source = ctx.sources.find((s) => s.id === storybookId);
					if (!source) {
						const availableSources = ctx.sources.map((s) => s.id).join(', ');
						return {
							content: [
								{
									type: 'text' as const,
									text: `Storybook source not found: "${storybookId}". Available sources: ${availableSources}. Use the ${LIST_TOOL_NAME} tool to see available sources.`,
								},
							],
							isError: true,
						};
					}

					const { componentManifest, docsManifest } = await getManifests(
						ctx.request,
						ctx.manifestProvider,
						source,
					);

					const component = componentManifest.components[id];
					const docsEntry = docsManifest?.docs[id];

					if (!component && !docsEntry) {
						await ctx.onGetDocumentation?.({
							context: ctx,
							input: { id, storybookId },
						});

						return {
							content: [
								{
									type: 'text' as const,
									text: `Component or Docs Entry not found: "${id}" in source "${storybookId}". Use the ${LIST_TOOL_NAME} tool to see available components and documentation entries.`,
								},
							],
							isError: true,
						};
					}

					const documentation = component ?? docsEntry!;
					const text = component
						? formatComponentManifest(documentation as ComponentManifest, format)
						: formatDocsManifest(documentation as Doc, format);

					await ctx.onGetDocumentation?.({
						context: ctx,
						input: { id, storybookId },
						foundDocumentation: documentation,
						resultText: text,
					});

					return {
						content: [
							{
								type: 'text' as const,
								text,
							},
						],
					};
				}

				// Single-source mode: no composition (storybookId ignored)
				const { componentManifest, docsManifest } = await getManifests(
					ctx?.request,
					ctx?.manifestProvider,
				);

				const component = componentManifest.components[id];
				const docsEntry = docsManifest?.docs[id];

				if (!component && !docsEntry) {
					await ctx?.onGetDocumentation?.({
						context: ctx,
						input: { id },
					});

					return {
						content: [
							{
								type: 'text' as const,
								text: `Component or Docs Entry not found: "${id}". Use the ${LIST_TOOL_NAME} tool to see available components and documentation entries.`,
							},
						],
						isError: true,
					};
				}

				const documentation = component ?? docsEntry!;
				const text = component
					? formatComponentManifest(documentation as ComponentManifest, format)
					: formatDocsManifest(documentation as Doc, format);

				await ctx?.onGetDocumentation?.({
					context: ctx,
					input: { id },
					foundDocumentation: documentation,
					resultText: text,
				});

				return {
					content: [
						{
							type: 'text' as const,
							text,
						},
					],
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}
