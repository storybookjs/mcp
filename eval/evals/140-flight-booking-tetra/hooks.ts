import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	postPrepareExperiment: async (experimentArgs) => {
		log.message('Installing the tetra package');
		const options = {
			cwd: experimentArgs.projectPath,
			silent: true,
		};
		await addDependency(['@chromatic-com/tetra@latest'], options);

		log.success('Tetra package installed');
	},
};

export default hooks;
