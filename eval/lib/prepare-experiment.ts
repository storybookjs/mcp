import type { ExperimentArgs } from '../types';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { installDependencies } from 'nypm';
import { taskLog } from '@clack/prompts';

export async function prepareExperiment({
	evalPath,
	experimentPath,
  resultsPath,
	projectPath,
}: ExperimentArgs) {
	const log = taskLog({ title: 'Preparing experiment' });
	
	log.message('Creating project from template')
	await fs.mkdir(path.join(evalPath, 'experiments'), { recursive: true });
	const projectTemplatePath = path.resolve(path.join('templates', 'project'));
	await fs.mkdir(experimentPath, { recursive: true });
  await fs.mkdir(resultsPath, { recursive: true });
	await fs.cp(projectTemplatePath, projectPath, {
		recursive: true,
		filter: (source) =>
			!source.includes('node_modules') && !source.includes('dist'),
	});

	log.message('Installing dependencies in project');
	await installDependencies({
		cwd: projectPath,
		packageManager: 'pnpm',
		silent: true,
	});
	log.success('Experiment prepared');
}
