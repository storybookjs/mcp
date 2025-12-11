import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { A11yViolations, StoryResult } from './result-types';

export async function writeStoryArtifacts(
	resultsPath: string,
	storyResults: StoryResult[],
	a11yViolations: A11yViolations,
) {
	const a11yViolationsPath = path.join(resultsPath, 'a11y-violations.json');
	await fs.writeFile(
		a11yViolationsPath,
		JSON.stringify(a11yViolations, null, 2),
	);

	const storyResultsPath = path.join(resultsPath, 'stories.json');
	await fs.writeFile(
		storyResultsPath,
		JSON.stringify({ stories: storyResults }, null, 2),
	);
}
