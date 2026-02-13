import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';
import { exec } from 'node:child_process';

const hooks: Hooks = {
	postPrepareTrial: async (trialArgs) => {
		log.message('Installing reshaped, msw-storybook-addon, and msw packages');
		await addDependency(['reshaped@latest', 'msw-storybook-addon@latest', 'msw@latest'], {
			cwd: trialArgs.projectPath,
			silent: true,
		});

		await fs.writeFile(
			path.join(trialArgs.projectPath, 'post.config.js'),
			`import config from 'reshaped/config/postcss';
export default config;
`,
		);

		// Run npx msw init public
		exec(`npx msw init public`, {
			cwd: trialArgs.projectPath,
		});

		await fs.unlink(path.join(trialArgs.projectPath, '.storybook', 'preview.ts'));

		log.success(
			'Reshaped package installed, PostCSS config added, MSW packages installed and MSW for Storybook configured',
		);
	},
};

export default hooks;
