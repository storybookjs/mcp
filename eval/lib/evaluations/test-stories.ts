import { startVitest } from 'vitest/node';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { EvaluationSummary, ExperimentArgs } from '../../types';
import type { JsonTestResults } from 'vitest/reporters';

export async function testStories({
	projectPath,
	resultsPath,
}: ExperimentArgs): Promise<Pick<EvaluationSummary, 'test' | 'a11y'>> {
	const testResultsPath = path.join(resultsPath, 'tests.json');

	const vitest = await startVitest('test', undefined, {
		root: projectPath,
		watch: false,
		silent: true,
		reporters: ['json'],
		outputFile: testResultsPath,
	});

	await vitest.close();

	const { default: jsonTestResults } = (await import(testResultsPath, {
		with: { type: 'json' },
	})) as { default: JsonTestResults };

	// write the file again to pretty-print it
	await fs.writeFile(testResultsPath, JSON.stringify(jsonTestResults, null, 2));

	// Extract a11y violations per story
	const a11yViolations: Record<string, any[]> = {};

	for (const jsonTestResult of Object.values(jsonTestResults.testResults)) {
		for (const assertionResult of jsonTestResult.assertionResults ?? []) {
			const storyId = (assertionResult.meta as any)?.storyId;
			if (!storyId) {
				continue;
			}

			for (const report of (assertionResult.meta as any).reports ?? []) {
				if (report.type === 'a11y' && report.result?.violations?.length > 0) {
					a11yViolations[storyId] = report.result.violations;
				}
			}
		}
	}

	const a11yViolationsPath = path.join(resultsPath, 'a11y-violations.json');
	await fs.writeFile(
		a11yViolationsPath,
		JSON.stringify(a11yViolations, null, 2),
	);

	return {
		test: {
			passed: jsonTestResults.numPassedTests,
			failed: jsonTestResults.numFailedTests,
		},
		a11y: {
			violations: Object.keys(a11yViolations).length,
		},
	};
}
