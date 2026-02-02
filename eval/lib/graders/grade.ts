import type { GradingSummary, TrialArgs } from '../../types.ts';
import { runESLint } from './lint.ts';
import { prepareGrading } from './prepare-grading.ts';
import { testStories } from './test-stories.ts';
import { checkTypes } from './typecheck.ts';
import { build } from './build.ts';
import { computeComponentUsageScore } from './component-usage.ts';
import { gradeMcpTools } from './mcp-tools.ts';
import { taskLog } from '@clack/prompts';
import { x } from 'tinyexec';
import { runHook } from '../run-hook.ts';

export async function grade(trialArgs: TrialArgs): Promise<GradingSummary> {
	const log = taskLog({ title: 'Grading' });
	await runHook('pre-grade', trialArgs);

	const prepareGroup = log.group('Preparing grading');
	await prepareGrading(trialArgs);
	prepareGroup.success('Grading prepared');

	const buildTask = async () => {
		const group = log.group('Building project');
		const result = await build(trialArgs);
		if (result) {
			group.success('Build succeeded');
		} else {
			group.error('Build failed');
		}
		return result;
	};

	const typeCheckTask = async () => {
		const group = log.group('Checking types');
		const result = await checkTypes(trialArgs);
		if (result === 0) {
			group.success('Type check succeeded');
		} else {
			group.error('Type check failed');
		}
		return result;
	};

	const lintTask = async () => {
		const group = log.group('Linting');
		const result = await runESLint(trialArgs);
		if (result === 0) {
			group.success('Linting succeeded');
		} else {
			group.error('Linting failed');
		}
		return result;
	};

	const testTask = async () => {
		const group = log.group('Testing stories');
		const result = await testStories(trialArgs);
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
			trialArgs.projectPath,
			trialArgs.taskPath,
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

	const mcpToolsTask = async () => {
		const group = log.group('Extracting MCP tools metrics');
		const result = await gradeMcpTools(trialArgs);
		if (result === undefined) {
			group.success('No MCP tools used');
		} else {
			const badge =
				result.allExpectationsPassed === undefined
					? ''
					: result.allExpectationsPassed
						? ' ✓'
						: ' ✗';
			const tokens =
				result.totalOutputTokens >= 1000
					? `${(result.totalOutputTokens / 1000).toFixed(1)}k`
					: String(result.totalOutputTokens);
			group.success(
				`${result.totalCalls} calls, ${tokens} output tokens${badge}`,
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
		mcpTools,
	] = await Promise.all([
		buildTask(),
		typeCheckTask(),
		lintTask(),
		componentUsageTask(),
		testTask(),
		mcpToolsTask(),
	]);

	const formatGroup = log.group('Formatting results');
	await x('pnpm', ['exec', 'prettier', '--write', trialArgs.resultsPath]);
	formatGroup.success('Results formatted');

	const gradingSummary: GradingSummary = {
		buildSuccess,
		typeCheckErrors,
		lintErrors,
		componentUsage,
		mcpTools,
		...testResults,
	};

	await runHook('post-grade', trialArgs);
	log.success('Grading completed');

	return gradingSummary;
}
