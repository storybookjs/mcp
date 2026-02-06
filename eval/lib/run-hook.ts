import type { TrialArgs, Hooks } from '../types.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Step configuration mapping step names to their directory and hook names.
 * Directory names are kebab-case, hook names are camelCase.
 */
const HOOK_CONFIG = {
	'pre-prepare-trial': {
		directory: 'pre-prepare-trial',
		hookName: 'prePrepareTrial',
	},
	'post-prepare-trial': {
		directory: 'post-prepare-trial',
		hookName: 'postPrepareTrial',
	},
	'pre-execute-agent': {
		directory: 'pre-execute-agent',
		hookName: 'preExecuteAgent',
	},
	'post-execute-agent': {
		directory: 'post-execute-agent',
		hookName: 'postExecuteAgent',
	},
	'pre-grade': {
		directory: 'pre-grade',
		hookName: 'preGrade',
	},
	'post-grade': {
		directory: 'post-grade',
		hookName: 'postGrade',
	},
	'pre-save': {
		directory: 'pre-save',
		hookName: 'preSave',
	},
	'post-save': {
		directory: 'post-save',
		hookName: 'postSave',
	},
} as const satisfies Record<string, { directory: string; hookName: keyof Hooks }>;

export type HookName = keyof typeof HOOK_CONFIG;

/**
 * Runs a lifecycle step for a trial.
 *
 * This function:
 * 1. Checks if a directory matching the step name exists in the task path
 * 2. If it exists, copies all contents recursively to projectPath (merging directories, overwriting files)
 * 3. Calls the corresponding hook function if defined
 *
 * @param hookName - The name of the step to run (e.g., 'pre-grade', 'post-prepare-trial')
 * @param trialArgs - The trial arguments containing paths and hooks
 */
export async function runHook(hookName: HookName, trialArgs: TrialArgs): Promise<void> {
	const config = HOOK_CONFIG[hookName];
	const hookDir = path.join(trialArgs.taskPath, config.directory);

	const hookDirExists = await fs
		.access(hookDir)
		.then(() => true)
		.catch(() => false);

	if (hookDirExists) {
		await fs.cp(hookDir, trialArgs.projectPath, {
			recursive: true,
			force: true,
		});
	}

	// Call the hook function if defined
	await trialArgs.hooks[config.hookName]?.(trialArgs);
}
