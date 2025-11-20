import type { ExperimentArgs } from '../types';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { installDependencies } from 'nypm';
import { taskLog } from '@clack/prompts';

export async function prepareExperiment(experimentArgs: ExperimentArgs) {
	const log = taskLog({
		title: 'Preparing experiment',
		retainLog: experimentArgs.verbose,
	});
	await experimentArgs.hooks.prePrepareExperiment?.(experimentArgs, log);

	log.message('Creating project from template');
	await fs.mkdir(path.join(experimentArgs.evalPath, 'experiments'), {
		recursive: true,
	});
	const projectTemplatePath = path.resolve(path.join('templates', 'project'));
	await fs.mkdir(experimentArgs.projectPath, { recursive: true });
	await fs.mkdir(experimentArgs.resultsPath, { recursive: true });
	await fs.cp(projectTemplatePath, experimentArgs.projectPath, {
		recursive: true,
		filter: (source) =>
			!source.includes('node_modules') && !source.includes('dist'),
	});

	const packageJsonPath = path.join(experimentArgs.projectPath, 'package.json');
	const { default: packageJson } = await import(packageJsonPath, {
		with: { type: 'json' },
	});
	packageJson.name =
		`@storybook/mcp-eval--${experimentArgs.evalName}--${path.basename(experimentArgs.experimentPath)}`.toLowerCase();

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	log.message('Installing dependencies in project');
	await installDependencies({
		cwd: experimentArgs.projectPath,
		packageManager: 'pnpm',
		silent: true,
	});

	await experimentArgs.hooks.postPrepareExperiment?.(experimentArgs, log);
	log.success('Experiment prepared');
}
