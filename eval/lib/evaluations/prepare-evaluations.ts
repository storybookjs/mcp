import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDevDependency } from 'nypm';
import type { ExperimentArgs } from '../../types';

export async function prepareEvaluations({
	projectPath,
	evalPath,
}: ExperimentArgs) {
	await addDevDependency(
		[
			'vitest@catalog:experiments',
			'@vitest/browser-playwright@catalog:experiments',
			'storybook@catalog:experiments',
			'@storybook/addon-docs@catalog:experiments',
			'@storybook/addon-a11y@catalog:experiments',
			'@storybook/addon-vitest@catalog:experiments',
			'@storybook/react-vite@catalog:experiments',
			'eslint-plugin-storybook@catalog:experiments',
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
		.cp(
			path.join(evalPath, 'expected', 'stories'),
			path.join(projectPath, 'stories'),
			{
				recursive: true,
				force: true,
			},
		)
		.catch(() => {});
}
