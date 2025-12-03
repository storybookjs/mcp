import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	postPrepareExperiment: async (experimentArgs) => {
		log.message('Installing the reshaped package');
		await addDependency('reshaped@latest', {
			cwd: experimentArgs.projectPath,
			silent: true,
		});

		await fs.writeFile(
			path.join(experimentArgs.projectPath, 'post.config.js'),
			`import config from 'reshaped/config/postcss';
export default config;
`,
		);
		log.success('Reshaped package installed, PostCSS config added');
	},
};

export default hooks;
