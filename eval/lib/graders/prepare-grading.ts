import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDevDependency } from 'nypm';
import type { TrialArgs } from '../../types.ts';

export async function prepareGrading({ projectPath }: TrialArgs) {
	await addDevDependency(
		[
			'vitest@catalog:trials',
			'@vitest/browser-playwright@catalog:trials',
			'storybook@catalog:trials',
			'@storybook/addon-docs@catalog:trials',
			'@storybook/addon-a11y@catalog:trials',
			'@storybook/addon-mcp@workspace:*',
			'@storybook/addon-vitest@catalog:trials',
			'@storybook/react-vite@catalog:trials',
			'eslint-plugin-storybook@catalog:trials',
		],
		{ cwd: projectPath, silent: true },
	);
	const gradingTemplateDir = path.resolve(path.join('templates', 'grading'));
	await fs.cp(gradingTemplateDir, projectPath, {
		recursive: true,
		filter: (source) =>
			!source.includes('node_modules') &&
			!source.includes('dist') &&
			// Only include coverage docs once coverage JSON exists; otherwise Storybook will
			// error on the static imports inside `results/coverage.mdx`.
			!source.endsWith(path.join('results', 'coverage.mdx')),
	});

	const pkgJsonPath = path.join(projectPath, 'package.json');
	const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));
	// add the storybook script after agent execution, so it does not taint the trial
	pkgJson.scripts.storybook = 'storybook dev --port 6006';

	await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(pkgJson, null, 2));
}
