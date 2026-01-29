import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	postPrepareTrial: async (trialArgs) => {
		log.message('Installing the rsuite package');
		await addDependency('rsuite@latest', {
			cwd: trialArgs.projectPath,
			silent: true,
		});
		log.success('Rsuite package installed');
	},
};

export default hooks;
