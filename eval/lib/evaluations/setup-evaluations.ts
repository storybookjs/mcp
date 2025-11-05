import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDevDependency } from 'nypm';
import type { ExperimentArgs } from '../../types';

export async function setupEvaluations({
	projectPath,
	evalPath,
}: ExperimentArgs) {
	await addDevDependency(
		[
			'vitest@catalog:',
			'@vitest/browser-playwright@catalog:',
			'storybook@catalog:',
			'@storybook/react-vite@catalog:',
			'@storybook/addon-vitest@catalog:',
			'@storybook/addon-a11y@catalog:',
			'eslint-plugin-storybook@catalog:',
		],
		{ cwd: projectPath, silent: true },
	);
	const evaluationTemplateDir = path.resolve(
		path.join('templates', 'evaluation'),
	);
	await fs.cp(evaluationTemplateDir, projectPath, {
		recursive: true,
		filter: (source) =>
			!source.includes('node_modules') && !source.includes('dist'),
	});
	await fs
		.cp(path.join(evalPath, 'expected', 'stories'), path.join(projectPath, 'stories'), {
			recursive: true,
			force: true,
		})
		.catch(() => {});
}
