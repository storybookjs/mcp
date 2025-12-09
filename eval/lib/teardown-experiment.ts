import type { ExperimentArgs } from '../types.ts';
import { taskLog } from '@clack/prompts';
import { stopStorybookDevServer } from './storybook-dev-server.ts';

export async function teardownExperiment(
	experimentArgs: ExperimentArgs,
): Promise<void> {
	const log = taskLog({
		title: 'Tearing down experiment',
		retainLog: experimentArgs.verbose,
	});

	// Stop storybook dev server if it was started for storybook-mcp-dev context
	if (experimentArgs.context.type === 'storybook-mcp-dev') {
		log.message('Stopping Storybook dev server...');
		stopStorybookDevServer();
		log.message('Storybook dev server stopped');
	}

	log.success('Experiment teardown complete');
}
