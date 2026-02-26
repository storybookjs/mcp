import type { CalculateQualityFn, Hooks, QualityResult } from '../../types.ts';
import { combine, fromMcpToolsCoverage } from '../../lib/quality/index.ts';

const DESCRIPTION = 'Preview Input Strategy (Story ID)';

const fromPreviewStoryIdInput: CalculateQualityFn = ({ grading }): QualityResult | undefined => {
	const previewTool = grading.mcpTools?.tools.find(
		(tool) => tool.name.includes('preview-stories') || tool.fullName.includes('preview-stories'),
	);

	if ((previewTool?.callCount ?? 0) === 0) {
		return {
			score: 0,
			description: DESCRIPTION,
		};
	}

	const hasStoryIdInput =
		previewTool?.invocations.some(({ input }) => {
			const stories = (input as { stories?: unknown } | undefined)?.stories;
			if (!Array.isArray(stories)) {
				return false;
			}

			return stories.some((story) => {
				if (!story || typeof story !== 'object') {
					return false;
				}

				return 'storyId' in story;
			});
		}) ?? false;

	return {
		score: hasStoryIdInput ? 1 : 0,
		description: DESCRIPTION,
	};
};

const hooks: Hooks = {
	calculateQuality: combine([fromMcpToolsCoverage, 0.7], [fromPreviewStoryIdInput, 0.3]),
};

export default hooks;
