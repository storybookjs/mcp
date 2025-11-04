import { startVitest } from 'vitest/node';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ExperimentArgs } from '../../types';

export async function testStories({
	projectPath,
	resultsPath,
	verbose,
}: ExperimentArgs) {
	const reporters = ['json'];
	if (verbose) {
		reporters.push('verbose');
	}
	const testResultsPath = path.join(resultsPath, 'tests.json');

	const vitest = await startVitest('test', undefined, {
		root: projectPath,
		watch: false,
		reporters,
		outputFile: testResultsPath,
	});

	const testModules = vitest.state.getTestModules();

	await vitest.close();
	
	const { default: testResultsRaw } = await import(testResultsPath, {
		with: { type: 'json' },
	});

	// write the file again to pretty-print it
	await fs.writeFile(testResultsPath, JSON.stringify(testResultsRaw, null, 2));

	// Extract a11y violations per story
	const a11yViolations: Record<string, any[]> = {};
	
	for (const suite of Object.values(testResultsRaw.default?.testResults ?? []) as any[]) {
		for (const assertion of suite.assertionResults ?? []) {
			const storyId = assertion.meta?.storyId;
			if (!storyId) {
				continue;
			}

			for (const report of assertion.meta?.reports ?? []) {
				if (report.type === 'a11y' && report.result?.violations?.length > 0) {
					a11yViolations[storyId] = report.result.violations;
				}
			}
		}
	}

	const a11yViolationsPath = path.join(resultsPath, 'a11y-violations.json');
	await fs.writeFile(
		a11yViolationsPath,
		JSON.stringify(a11yViolations, null, 2)
	);

	return {
		tests: testModules.every((testModule) => testModule.ok()),
		a11y: Object.keys(a11yViolations).length === 0
	};
}
