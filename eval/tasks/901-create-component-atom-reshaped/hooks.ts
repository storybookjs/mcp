import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Hooks } from '../../types.ts';
import { fromMcpToolsCoverage } from '../../lib/quality/index.ts';
import { addDependency } from 'nypm';
import { log } from '@clack/prompts';

const hooks: Hooks = {
	// TODO: This quality signal is incomplete. It currently relies on MCP tool-call
	// expectations only, and should also verify that the agent actually wrote the
	// expected stories for the task.
	calculateQuality: fromMcpToolsCoverage,
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

		await fs.unlink(path.join(trialArgs.projectPath, '.storybook', 'preview.tsx'));

		log.success('Reshaped package installed, PostCSS config added');
	},
};

export default hooks;
