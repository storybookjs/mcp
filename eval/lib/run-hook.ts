import type { ExperimentArgs, Hooks } from '../types.ts';
import type { taskLog } from '@clack/prompts';
import type { TaskLogger } from './evaluations/evaluate.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Step configuration mapping step names to their directory and hook names.
 * Directory names are kebab-case, hook names are camelCase.
 */
const HOOK_CONFIG = {
	'pre-prepare-experiment': {
		directory: 'pre-prepare-experiment',
		hookName: 'prePrepareExperiment',
	},
	'post-prepare-experiment': {
		directory: 'post-prepare-experiment',
		hookName: 'postPrepareExperiment',
	},
	'pre-execute-agent': {
		directory: 'pre-execute-agent',
		hookName: 'preExecuteAgent',
	},
	'post-execute-agent': {
		directory: 'post-execute-agent',
		hookName: 'postExecuteAgent',
	},
	'pre-evaluate': {
		directory: 'pre-evaluate',
		hookName: 'preEvaluate',
	},
	'post-evaluate': {
		directory: 'post-evaluate',
		hookName: 'postEvaluate',
	},
	'pre-save': {
		directory: 'pre-save',
		hookName: 'preSave',
	},
	'post-save': {
		directory: 'post-save',
		hookName: 'postSave',
	},
} as const satisfies Record<
	string,
	{ directory: string; hookName: keyof Hooks }
>;

export type HookName = keyof typeof HOOK_CONFIG;

export type Logger = ReturnType<typeof taskLog> | TaskLogger;

/**
 * Runs a lifecycle step for an experiment.
 *
 * This function:
 * 1. Checks if a directory matching the step name exists in the eval path
 * 2. If it exists, copies all contents recursively to projectPath (merging directories, overwriting files)
 * 3. Calls the corresponding hook function if defined
 *
 * @param hookName - The name of the step to run (e.g., 'pre-evaluate', 'post-prepare-experiment')
 * @param experimentArgs - The experiment arguments containing paths and hooks
 * @param log - Logger instance for output
 */
export async function runHook(
	hookName: HookName,
	experimentArgs: ExperimentArgs,
	log: Logger,
): Promise<void> {
	const config = HOOK_CONFIG[hookName];
	const hookDir = path.join(experimentArgs.evalPath, config.directory);

	const hookDirExists = await fs
		.access(hookDir)
		.then(() => true)
		.catch(() => false);

	if (hookDirExists) {
		await fs.cp(hookDir, experimentArgs.projectPath, {
			recursive: true,
			force: true,
		});
	}

	// Call the hook function if defined
	await experimentArgs.hooks[config.hookName]?.(experimentArgs, log as any);
}
