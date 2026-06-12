import type { McpServer } from 'tmcp';
import type { AddonContext } from '../types.ts';
import type { ToolAvailability } from '../utils/get-tool-availability.ts';
import { buildServerInstructions } from './build-server-instructions.ts';

/**
 * Computes the server's workflow instructions for the live request, combining the
 * per-request toolset state (from the addon context) with the startup-time tool
 * availability. Shared by the `instructions` field on `initialize` and the
 * `get-storybook-workflow` tool so the two access paths can't drift.
 */
export function getLiveServerInstructions(
	server: McpServer<any, AddonContext>,
	availability: ToolAvailability,
): string {
	return buildServerInstructions({
		devEnabled: server?.ctx.custom?.toolsets?.dev ?? true,
		testEnabled: (server?.ctx.custom?.toolsets?.test ?? true) && availability.testSupported,
		docsEnabled: (server?.ctx.custom?.toolsets?.docs ?? true) && availability.docsEnabled,
		changeDetectionEnabled: availability.changeDetectionEnabled,
		moduleGraphSupported: availability.moduleGraphSupported,
		reviewEnabled: availability.reviewEnabled,
	});
}
