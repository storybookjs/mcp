import { isDevContext } from '../context-utils.ts';
import type { GradingSummary, TrialArgs } from '../../types.ts';
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
}: TrialArgs): Promise<Pick<GradingSummary, 'test' | 'a11y' | 'coverage'>> {
	const isDevTrial = isDevContext(context);
	const testScript = isDevTrial ? 'eval:test:coverage' : 'eval:test';

	await runTests({ projectPath, resultsPath } as TrialArgs, testScript);

	const { testSummary, a11y, storyResults } = await parseTestResults(resultsPath);

	await writeStoryArtifacts(resultsPath, storyResults, a11y);

	const { coverage } = isDevTrial
		? await computeCoverage(projectPath, resultsPath)
		: { coverage: undefined };

	if (coverage) {
		const templateCoverageMdxPath = path.resolve(
			path.join('templates', 'grading', 'results', 'coverage.mdx'),
		);
		const projectCoverageMdxPath = path.join(projectPath, 'results', 'coverage.mdx');
		await fs.copyFile(templateCoverageMdxPath, projectCoverageMdxPath);
	}

	return {
		test: testSummary,
		a11y: { violations: Object.keys(a11y).length },
		coverage: isDevTrial ? coverage : undefined,
	};
}
