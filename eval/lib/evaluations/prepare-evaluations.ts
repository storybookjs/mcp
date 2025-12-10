import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDevDependency } from 'nypm';
import type { ExperimentArgs } from '../../types.ts';

export async function prepareEvaluations({ projectPath }: ExperimentArgs) {
	await addDevDependency(
		[
			'vitest@catalog:experiments',
			'@vitest/browser-playwright@catalog:experiments',
			'storybook@catalog:experiments',
			'@storybook/addon-docs@catalog:experiments',
			'@storybook/addon-a11y@catalog:experiments',
			'@storybook/addon-mcp@workspace:*',
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

	const { default: pkgJson } = await import(
		path.join(projectPath, 'package.json'),
		{
			with: { type: 'json' },
		}
	);
	// add the storybook script after agent execution, so it does not taint the experiment
	pkgJson.scripts.storybook = 'storybook dev --port 6006';
	await fs.writeFile(
		path.join(projectPath, 'package.json'),
		JSON.stringify(pkgJson, null, 2),
	);
}
