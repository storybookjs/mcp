import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';
import { combine, fromComponentUsage, fromMcpToolsCoverage } from '../../lib/quality/index.ts';

const hooks: Hooks = {
	postPrepareTrial: async (trialArgs) => {
		log.message('Installing the reshaped package');
		await addDependency('reshaped@latest', {
			cwd: trialArgs.projectPath,
			silent: true,
		});

		await fs.writeFile(
			path.join(trialArgs.projectPath, 'post.config.js'),
			`import config from 'reshaped/config/postcss';
export default config;
`,
		);
		log.success('Reshaped package installed, PostCSS config added');
	},

	calculateQuality: fromComponentUsage,
};

export default hooks;
