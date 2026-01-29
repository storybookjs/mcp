import type { Hooks } from '../../types.ts';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	postPrepareTrial: async (trialArgs) => {
		// Custom logic to run after preparing the trial
		log.success(
			`Post-prepare hook executed for trial at ${trialArgs.trialPath}`,
		);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate async work
	},
};

export default hooks;
