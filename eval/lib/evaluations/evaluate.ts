import type { EvaluationSummary, ExperimentArgs } from '../../types.ts';
import { runESLint } from './lint.ts';
import { prepareEvaluations } from './prepare-evaluations.ts';
import { testStories } from './test-stories.ts';
import { checkTypes } from './typecheck.ts';
import { build } from './build.ts';
import { computeComponentUsageScore } from './component-usage.ts';
import { taskLog } from '@clack/prompts';
import { x } from 'tinyexec';
import { runHook } from '../run-hook.ts';

export async function evaluate(
	experimentArgs: ExperimentArgs,
): Promise<EvaluationSummary> {
	const log = taskLog({ title: 'Evaluating' });
	await runHook('pre-evaluate', experimentArgs);

	const prepareGroup = log.group('Preparing evaluations');
	await prepareEvaluations(experimentArgs);
	prepareGroup.success('Evaluations prepared');

	const buildTask = async () => {
		const group = log.group('Building project');
		const result = await build(experimentArgs);
		if (result) {
			group.success('Build succeeded');
		} else {
			group.error('Build failed');
		}
		return result;
	};

	const typeCheckTask = async () => {
		const group = log.group('Checking types');
		const result = await checkTypes(experimentArgs);
		if (result === 0) {
			group.success('Type check succeeded');
		} else {
			group.error('Type check failed');
		}
		return result;
	};

	const lintTask = async () => {
		const group = log.group('Linting');
		const result = await runESLint(experimentArgs);
		if (result === 0) {
			group.success('Linting succeeded');
		} else {
			group.error('Linting failed');
		}
		return result;
	};

	const testTask = async () => {
		const group = log.group('Testing stories');
		const result = await testStories(experimentArgs);
		const totalTests = result.test.passed + result.test.failed;
		if (result.test.failed === 0) {
			group.success(
				`${result.test.passed} / ${totalTests} tests passed with ${result.a11y.violations} accessibility violations`,
			);
		} else {
			group.error(`${result.test.passed} / ${totalTests} tests passed.`);
		}
		return result;
	};

	const componentUsageTask = async () => {
		const group = log.group('Checking component usage');
		const result = await computeComponentUsageScore(
			experimentArgs.projectPath,
			experimentArgs.evalPath,
		);
		if (result === undefined) {
			group.success('No expected imports configured, skipped');
		} else if (
			result.matched > 0 &&
			result.missing === 0 &&
			result.unexpected === 0
		) {
			group.success(
				`Score: ${result.score} (matched: ${result.matched}, missing: ${result.missing}, unexpected: ${result.unexpected})`,
			);
		} else if (result.matched === 0) {
			group.error(
				`Score: ${result.score} (matched: ${result.matched}, missing: ${result.missing}, unexpected: ${result.unexpected})`,
			);
		} else {
			group.message(
				`Score: ${result.score} (matched: ${result.matched}, missing: ${result.missing}, unexpected: ${result.unexpected})`,
			);
		}
		return result;
	};

	const [
		buildSuccess,
		typeCheckErrors,
		lintErrors,
		componentUsage,
		testResults,
	] = await Promise.all([
		buildTask(),
		typeCheckTask(),
		lintTask(),
		componentUsageTask(),
		testTask(),
	]);

	const formatGroup = log.group('Formatting results');
	await x('pnpm', ['exec', 'prettier', '--write', experimentArgs.resultsPath]);
	formatGroup.success('Results formatted');

	const evaluationSummary: EvaluationSummary = {
		buildSuccess,
		typeCheckErrors,
		lintErrors,
		componentUsage,
		...testResults,
	};

	await runHook('post-evaluate', experimentArgs);
	log.success('Evaluation completed');

	return evaluationSummary;
}
