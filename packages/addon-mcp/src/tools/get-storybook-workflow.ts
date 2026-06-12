import type { McpServer } from 'tmcp';
import type { AddonContext } from '../types.ts';
import type { ToolAvailability } from '../utils/get-tool-availability.ts';
import { collectTelemetry } from '../telemetry.ts';
import { errorToMCPContent } from '../utils/errors.ts';
import { getLiveServerInstructions } from '../instructions/get-live-server-instructions.ts';
import { GET_STORYBOOK_WORKFLOW_TOOL_NAME } from './tool-names.ts';

export async function addGetStorybookWorkflowTool(
	server: McpServer<any, AddonContext>,
	availability: ToolAvailability,
) {
	server.tool(
		{
			name: GET_STORYBOOK_WORKFLOW_TOOL_NAME,
			title: 'Storybook Workflow',
			description: `Get the recommended Storybook workflow: which Storybook MCP tools to call, when, and in what order.

Call this tool at the start of a session, or before doing any work that touches UI components or Storybook, to learn the workflows this server expects you to follow (developing UI, running story tests, looking up component documentation — depending on which toolsets are enabled).

This returns the high-level workflow (which tools to call when), not story-writing guidance — the workflow itself directs you to other tools such as get-storybook-story-instructions for that.`,
		},
		async () => {
			try {
				const { disableTelemetry } = server.ctx.custom ?? {};

				if (!disableTelemetry) {
					await collectTelemetry({
						event: 'tool:getStorybookWorkflow',
						server,
					});
				}

				const instructions = getLiveServerInstructions(server, availability);

				if (!instructions) {
					return {
						content: [
							{
								type: 'text' as const,
								text: buildNoWorkflowsMessage(server, availability),
							},
						],
					};
				}

				return {
					content: [{ type: 'text' as const, text: instructions }],
				};
			} catch (error) {
				return errorToMCPContent(error);
			}
		},
	);
}

function buildNoWorkflowsMessage(
	server: McpServer<any, AddonContext>,
	availability: ToolAvailability,
): string {
	const toolsets = server.ctx.custom?.toolsets;
	const reasons: string[] = [];

	if (!(toolsets?.dev ?? true)) {
		reasons.push('the `dev` toolset is disabled');
	}
	if (!(toolsets?.test ?? true)) {
		reasons.push('the `test` toolset is disabled');
	} else if (!availability.testSupported) {
		reasons.push('`@storybook/addon-vitest` is not installed (disables the `test` workflow)');
	}
	if (!(toolsets?.docs ?? true)) {
		reasons.push('the `docs` toolset is disabled');
	} else if (!availability.docsEnabled) {
		reasons.push(
			availability.docsFeatureEnabled
				? 'no component manifest is available (disables the `docs` workflow)'
				: 'the component manifest feature is not enabled (disables the `docs` workflow)',
		);
	}

	return `No Storybook workflows are currently available because ${reasons.join(', and ')}. Enable the relevant toolsets or features to get workflow instructions.`;
}
