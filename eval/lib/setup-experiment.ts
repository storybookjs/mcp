import type { ExperimentArgs } from '../types';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { installDependencies } from 'nypm';

export async function setupExperiment({
	evalPath,
	experimentPath,
  resultsPath,
	projectPath,
  verbose,
}: ExperimentArgs) {
	console.log(`Setting up experiment directory at '${experimentPath}'`);
	// Create experiments directory if it doesn't exist
	await fs.mkdir(path.join(evalPath, 'experiments'), { recursive: true });

	// Copy project template to experiment directory, excluding node_modules
	const projectTemplatePath = path.resolve(path.join('templates', 'project'));
	await fs.mkdir(experimentPath, { recursive: true });
  await fs.mkdir(resultsPath, { recursive: true });

	await fs.cp(projectTemplatePath, projectPath, {
		recursive: true,
		filter: (source) =>
			!source.includes('node_modules') && !source.includes('dist'),
	});

	console.log('Installing dependencies in experiment directory...');
	await installDependencies({
		cwd: projectPath,
		packageManager: 'pnpm',
		silent: !verbose,
	});
}
