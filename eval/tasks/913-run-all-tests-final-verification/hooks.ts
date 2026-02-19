import type { Hooks } from '../../types.ts';

const hooks: Hooks = {
	calculateQuality: ({ grading }) => {
		const runStoryTestsTool = grading.mcpTools?.tools.find(
			(tool) => tool.name.includes('run-story-tests') || tool.fullName.includes('run-story-tests'),
		);

		if ((runStoryTestsTool?.callCount ?? 0) === 0) {
			return {
				score: 0,
				description: 'Run Story Tests Input Mode',
			};
		}

		const callTestWithoutStoriesInput =
			runStoryTestsTool?.invocations.some(({ input }) => {
				const stories = (input as { stories?: unknown } | undefined)?.stories;
				return stories === undefined || (Array.isArray(stories) && stories.length === 0);
			}) ?? false;

		return {
			score: callTestWithoutStoriesInput ? 1 : 0.3,
			description: 'Run Story Tests Input Mode',
		};
	},
};

export default hooks;
