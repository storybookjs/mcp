import type { CalculateQualityFn, Hooks, QualityResult } from '../../types.ts';
import { combine, fromMcpToolsCoverage } from '../../lib/quality/index.ts';

const PREVIEW_DESCRIPTION = 'Preview Input Strategy (Path-Based)';
const DOCS_DESCRIPTION = 'Avoid Get Documentation For Button';

const fromPreviewPathBasedInput: CalculateQualityFn = ({ grading }): QualityResult | undefined => {
	const previewTool = grading.mcpTools?.tools.find(
		(tool) => tool.name.includes('preview-stories') || tool.fullName.includes('preview-stories'),
	);

	if ((previewTool?.callCount ?? 0) === 0) {
		return {
			score: 0,
			description: PREVIEW_DESCRIPTION,
		};
	}

	const hasPathBasedInput =
		previewTool?.invocations.some(({ input }) => {
			const stories = (input as { stories?: unknown } | undefined)?.stories;
			if (!Array.isArray(stories)) {
				return false;
			}

			return stories.some((story) => {
				if (!story || typeof story !== 'object') {
					return false;
				}

				return 'absoluteStoryPath' in story && 'exportName' in story;
			});
		}) ?? false;

	return {
		score: hasPathBasedInput ? 1 : 0,
		description: PREVIEW_DESCRIPTION,
	};
};

const fromNoGetDocumentationForButton: CalculateQualityFn = ({
	grading,
}): QualityResult | undefined => {
	const getDocumentationTool = grading.mcpTools?.tools.find(
		(tool) => tool.name === 'get-documentation',
	);

	if (!getDocumentationTool) {
		return {
			score: 1,
			description: DOCS_DESCRIPTION,
		};
	}

	const calledForButton = getDocumentationTool.invocations.some(({ input }) => {
		const id = (input as { id?: unknown } | undefined)?.id;
		return id === 'button';
	});

	return {
		score: calledForButton ? 0 : 1,
		description: DOCS_DESCRIPTION,
	};
};

const hooks: Hooks = {
	calculateQuality: combine(
		[fromMcpToolsCoverage, 0.1],
		[fromPreviewPathBasedInput, 0.6],
		[fromNoGetDocumentationForButton, 0.3],
	),
};

export default hooks;
