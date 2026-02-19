import type { CalculateQualityFn, Hooks, QualityResult } from '../../types.ts';
import { combine, fromA11yViolations, fromTestPassRate } from '../../lib/quality/index.ts';

const DESCRIPTION = 'Run Story Tests With Stories Input';

const fromRunStoryTestsWithStoriesInput: CalculateQualityFn = ({
	grading,
}): QualityResult | undefined => {
	const runStoryTestsTool = grading.mcpTools?.tools.find((tool) =>
		tool.name.includes('run-story-tests'),
	);

	if ((runStoryTestsTool?.callCount ?? 0) === 0) {
		return {
			score: 0,
			description: DESCRIPTION,
		};
	}

	const hasStoriesInput =
		runStoryTestsTool?.invocations.some(({ input }) => {
			const stories = (input as { stories?: unknown } | undefined)?.stories;
			return Array.isArray(stories);
		}) ?? false;

	return {
		score: hasStoriesInput ? 1 : 0,
		description: DESCRIPTION,
	};
};

const hooks: Hooks = {
	calculateQuality: combine(
		[fromRunStoryTestsWithStoriesInput, 0.4],
		[fromTestPassRate, 0.4],
		[fromA11yViolations, 0.2],
	),
};

export default hooks;
