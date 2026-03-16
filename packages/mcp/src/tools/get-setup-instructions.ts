import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { Doc, DocsManifestMap, StorybookContext } from '../types.ts';
import { StorybookIdField } from '../types.ts';
import { errorToMCPContent, getManifests, getMultiSourceManifests } from '../utils/get-manifest.ts';
import { formatDocsManifest } from '../utils/manifest-formatter/markdown.ts';
import { GET_TOOL_NAME } from './get-documentation.ts';
import { LIST_TOOL_NAME } from './list-all-documentation.ts';

export const GET_SETUP_INSTRUCTIONS_TOOL_NAME = 'get-setup-instructions';
export const SETUP_INSTRUCTIONS_TAG = 'setup-instructions';

function findSetupInstructionsDocs(docsManifest?: DocsManifestMap): Doc[] {
	return Object.values(docsManifest?.docs ?? {})
		.sort((left, right) => left.id.localeCompare(right.id))
		.filter((doc) => doc.tags?.includes(SETUP_INSTRUCTIONS_TAG));
}

async function hasSetupInstructions(ctx?: StorybookContext): Promise<boolean> {
	if (ctx?.sources?.some((source) => source.url)) {
		const manifests = await getMultiSourceManifests(ctx.sources, ctx.request, ctx.manifestProvider);
		return manifests.some(
			(manifest) => findSetupInstructionsDocs(manifest.docsManifest).length > 0,
		);
	}

	const manifests = await getManifests(ctx?.request, ctx?.manifestProvider);
	return findSetupInstructionsDocs(manifests.docsManifest).length > 0;
}

export async function addGetSetupInstructionsTool(
	server: McpServer<any, StorybookContext>,
	enabled?: Parameters<McpServer<any, StorybookContext>['tool']>[0]['enabled'],
	options?: { multiSource?: boolean },
) {
	const toolHandler = async (input: { storybookId?: string }) => {
		try {
			const ctx = server.ctx.custom;
			const { storybookId } = input;
			const sources = ctx?.sources;
			const isMultiSource = sources && sources.some((source) => source.url);

			let source;
			if (isMultiSource) {
				if (!storybookId) {
					const availableSources = sources.map((candidate) => candidate.id).join(', ');
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

				source = sources.find((candidate) => candidate.id === storybookId);
				if (!source) {
					const availableSources = sources.map((candidate) => candidate.id).join(', ');
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
			}

			const manifests = await getManifests(ctx?.request, ctx?.manifestProvider, source);
			const setupInstructions = findSetupInstructionsDocs(manifests.docsManifest);

			if (setupInstructions.length === 0) {
				const suffix = storybookId ? ` in source "${storybookId}"` : '';
				return {
					content: [
						{
							type: 'text' as const,
							text: `Setup instructions not found${suffix}. This Storybook does not expose a docs entry tagged "${SETUP_INSTRUCTIONS_TAG}". Use the ${LIST_TOOL_NAME} tool to inspect available documentation entries, and use ${GET_TOOL_NAME} for component APIs and usage examples.`,
						},
					],
					isError: true,
				};
			}

			return {
				content: setupInstructions.map((setupInstruction) => ({
					type: 'text' as const,
					text: formatDocsManifest(setupInstruction),
				})),
			};
		} catch (error) {
			return errorToMCPContent(error);
		}
	};

	const toolOptions = {
		name: GET_SETUP_INSTRUCTIONS_TOOL_NAME,
		title: 'Get Setup Instructions',
		description: `Get project-level setup instructions for this component library or design system.

Call this when you need installation steps, required providers or wrappers, theming/bootstrap setup, CSS/font/token initialization, framework integration, app-root wiring, or other environment preparation required before using the components. This returns every docs entry tagged "${SETUP_INSTRUCTIONS_TAG}" as separate text contents. Use ${GET_TOOL_NAME} for component APIs, props, examples, and story-driven usage details.`,
		enabled: async () => {
			if (enabled && (await enabled()) === false) {
				return false;
			}

			return await hasSetupInstructions(server.ctx.custom);
		},
	};

	if (options?.multiSource) {
		server.tool(
			{
				...toolOptions,
				schema: v.object(StorybookIdField),
			},
			toolHandler,
		);
		return;
	}

	server.tool(
		{
			...toolOptions,
			schema: v.object({}),
		},
		toolHandler,
	);
}
