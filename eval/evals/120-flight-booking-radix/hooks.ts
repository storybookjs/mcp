import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	postPrepareExperiment: async (experimentArgs) => {
		log.message('Installing the radix-ui package');
		const options = {
			cwd: experimentArgs.projectPath,
			silent: true,
		};
		await addDependency(
			[
				'radix-ui@^1.4.3',
				'@radix-ui/react-popover@^1.1.15',
				'@radix-ui/react-toggle@^1.1.10',
				'@radix-ui/react-toggle-group@^1.1.0',
				'@radix-ui/colors@^3.0.0',
			],
			options,
		);

		log.success('Radix UI package installed');
	},
};

export default hooks;
