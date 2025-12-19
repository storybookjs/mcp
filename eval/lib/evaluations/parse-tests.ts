import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { JsonAssertionResult, JsonTestResults } from 'vitest/reporters';
import type { A11yViolations, StoryResult, TestSummary } from './result-types';

export async function parseTestResults(resultsPath: string): Promise<{
	testSummary: TestSummary;
	a11y: A11yViolations;
	storyResults: StoryResult[];
}> {
	const testResultsPath = path.join(resultsPath, 'tests.json');
	const { default: jsonTestResults } = (await import(testResultsPath, {
		with: { type: 'json' },
	})) as { default: JsonTestResults };

	// write the file again to pretty-print it
	await fs.writeFile(testResultsPath, JSON.stringify(jsonTestResults, null, 2));

	const a11yViolations: A11yViolations = {};
	const storyAssertions: Record<
		string,
		{ status: JsonAssertionResult['status'] }
	> = {};

	const testSuites = jsonTestResults.testResults
		? Object.values(jsonTestResults.testResults)
		: [];

	for (const jsonTestResult of testSuites) {
		for (const assertionResult of jsonTestResult.assertionResults ?? []) {
			const storyId = (assertionResult.meta as any)?.storyId;
			if (!storyId) continue;

			storyAssertions[storyId] = {
				status: assertionResult.status,
			};

			for (const report of (assertionResult.meta as any).reports ?? []) {
				if (report.type === 'a11y' && report.result?.violations?.length > 0) {
					a11yViolations[storyId] = report.result.violations;
				}
			}
		}
	}

	const storyResults = Object.entries(storyAssertions).map(
		([storyId, { status }]) =>
			({
				storyId,
				status,
			}) as StoryResult,
	);

	const testsPassed = storyResults.filter((s) => s.status === 'passed').length;
	const testsFailed = storyResults.length - testsPassed;

	return {
		testSummary: {
			passed: testsPassed,
			failed: testsFailed,
		},
		a11y: a11yViolations,
		storyResults,
	};
}
