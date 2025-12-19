import { isDevEvaluation } from '../context-utils.ts';
import type { EvaluationSummary, ExperimentArgs } from '../../types.ts';
import { runTests } from './run-tests.ts';
import { parseTestResults } from './parse-tests.ts';
import { writeStoryArtifacts } from './write-story-artifacts.ts';
import { computeCoverage } from './coverage.ts';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function testStories({
	projectPath,
	resultsPath,
	context,
}: ExperimentArgs): Promise<
	Pick<EvaluationSummary, 'test' | 'a11y' | 'coverage'>
> {
	const isDevEval = isDevEvaluation(context);
	const testScript = isDevEval ? 'eval:test:coverage' : 'eval:test';

	await runTests({ projectPath, resultsPath } as ExperimentArgs, testScript);

	const { testSummary, a11y, storyResults } =
		await parseTestResults(resultsPath);

	await writeStoryArtifacts(resultsPath, storyResults, a11y);

	const { coverage } = isDevEval
		? await computeCoverage(projectPath, resultsPath)
		: { coverage: undefined };

	if (coverage) {
		const templateCoverageMdxPath = path.resolve(
			path.join('templates', 'evaluation', 'results', 'coverage.mdx'),
		);
		const projectCoverageMdxPath = path.join(
			projectPath,
			'results',
			'coverage.mdx',
		);
		await fs.copyFile(templateCoverageMdxPath, projectCoverageMdxPath);
	}

	return {
		test: testSummary,
		a11y: { violations: Object.keys(a11y).length },
		coverage: isDevEval ? coverage : undefined,
	};
}
