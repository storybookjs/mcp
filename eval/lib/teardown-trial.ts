import type { TrialArgs } from '../types.ts';
import { taskLog } from '@clack/prompts';
import { stopStorybookDevServer } from './storybook-dev-server.ts';

export async function teardownTrial(trialArgs: TrialArgs): Promise<void> {
	const log = taskLog({
		title: 'Tearing down trial',
		retainLog: trialArgs.verbose,
	});

	// Stop storybook dev server if it was started for storybook-mcp-dev context
	if (trialArgs.context.some((ctx) => ctx.type === 'storybook-mcp-dev')) {
		log.message('Stopping Storybook dev server...');
		stopStorybookDevServer();
		log.message('Storybook dev server stopped');
	}

	log.success('Trial teardown complete');
}
