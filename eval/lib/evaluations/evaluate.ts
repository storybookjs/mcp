import type { EvaluationSummary, ExperimentArgs } from '../../types';
import { saveEnvironment } from './environment.ts';
import { runESLint } from './lint.ts';
import { setupEvaluations } from './setup-evaluations.ts';
import { testStories } from './test-stories.ts';
import { checkTypes } from './typecheck.ts';
import { build } from './build.ts';
import { taskLog, spinner } from '@clack/prompts';
import { x } from 'tinyexec';

export type TaskLogger = {
	start: (title: string) => void;
	success: (message: string) => void;
	error: (message: string) => void;
	message: (message: string) => void;
	complete: (message: string) => void;
};

/**
 * Creates a unified logging interface that adapts to verbose/non-verbose modes.
 * In verbose mode, uses taskLog with groups for structured output.
 * In non-verbose mode, uses a single spinner with progress messages.
 */
function createTaskLogger(verbose: boolean, title: string): TaskLogger {
	if (verbose) {
		const verboseLog = taskLog({ title, retainLog: verbose });
		let currentGroup: ReturnType<typeof verboseLog.group> | null = null;
		return {
			start: (title: string) => {
				currentGroup = verboseLog.group(title);
			},
			success: (message: string) => {
				currentGroup?.success(message);
				currentGroup = null;
			},
			error: (message: string) => {
				currentGroup?.error(message);
				currentGroup = null;
			},
			message: (message: string) => {
				verboseLog.message(message);
			},
			complete: (message: string) => {
				verboseLog.success(message);
			},
		};
	} else {
		const normalLog = spinner();
		normalLog.start(title);
		return {
			start: (title: string) => {
				normalLog.message(title);
			},
			success: (message: string) => {
				normalLog.message(message);
			},
			error: (message: string) => {
				normalLog.message(message);
			},
			message: (message: string) => {
				normalLog.message(message);
			},
			complete: (message: string) => {
				normalLog.stop(message);
			},
		};
	}
}

export async function evaluate(
	experimentArgs: ExperimentArgs,
	agent: string,
): Promise<EvaluationSummary> {
	const { verbose } = experimentArgs;
	const log = createTaskLogger(verbose, 'Evaluating');
	await experimentArgs.hooks.preEvaluate?.(experimentArgs, log);

	log.start('Setting up evaluations');
	await setupEvaluations(experimentArgs);
	log.success('Evaluations set up completed');

	const buildTask = async () => {
		log.start('Building project');
		const result = await build(experimentArgs);
		if (result) {
			log.success('Build succeeded');
		} else {
			log.error('Build failed');
		}
		return result;
	};

	const typeCheckTask = async () => {
		log.start('Checking types');
		const result = await checkTypes(experimentArgs);
		if (result) {
			log.success('Type check succeeded');
		} else {
			log.error('Type check failed');
		}
		return result;
	};

	const lintTask = async () => {
		log.start('Linting');
		const result = await runESLint(experimentArgs);
		if (result) {
			log.success('Linting succeeded');
		} else {
			log.error('Linting failed');
		}
		return result;
	};

	const testTask = async () => {
		log.start('Testing stories');
		const result = await testStories(experimentArgs);
		if (result.tests) {
			log.success(
				`Tests passed with${result.a11y ? '' : 'out'} accessibility violations`,
			);
		} else {
			log.error('Tests failed');
		}
		return result;
	};

	const saveEnvTask = async () => {
		log.start('Saving environment');
		await saveEnvironment(experimentArgs, agent);
		log.success('Environment saved');
	};

	const [buildSuccess, typeCheckSuccess, lintSuccess, testResults] =
		await Promise.all([
			buildTask(),
			typeCheckTask(),
			lintTask(),
			testTask(),
			saveEnvTask(),
		]);

	log.start('Formatting results');
	await x('pnpm', ['exec', 'prettier', '--write', experimentArgs.resultsPath]);
	log.success('Results formatted');

	await experimentArgs.hooks.postEvaluate?.(experimentArgs, log);
	log.complete('Evaluation completed');

	return {
		buildSuccess,
		typeCheckSuccess,
		lintSuccess,
		testSuccess: testResults.tests,
		a11ySuccess: testResults.a11y,
	};
}
