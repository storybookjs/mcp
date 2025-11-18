import type { Hooks } from '../../types.ts';

const hooks: Hooks = {
	postPrepareExperiment: async (experimentArgs, log) => {
		// Custom logic to run after preparing the experiment
		log.success(
			`Post-prepare hook executed for experiment at ${experimentArgs.experimentPath}`,
		);
		await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate async work
	},
};

export default hooks;
