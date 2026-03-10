import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { CalculateQualityFn, Hooks, QualityResult } from '../../types.ts';
import { combine } from '../../lib/quality/index.ts';

const PREVIEW_DESCRIPTION = 'Preview Input Strategy (Path-Based)';
const DOCS_DESCRIPTION = 'Avoid Get Documentation For Button';
const FINAL_URLS_DESCRIPTION = 'Final Response Includes Preview URLs';

const EXPECTED_PREVIEW_URL_PATTERNS = [
	/https?:\/\/[^\s)]+\?path=\/story\/example-button--primary(?:&[^\s)]*)?/i,
	/https?:\/\/[^\s)]+\?path=\/story\/example-button--secondary(?:&[^\s)]*)?/i,
];

function extractFinalAssistantText(resultsPath: string): string | undefined {
	try {
		const transcriptPath = path.join(resultsPath, 'transcript.json');
		const transcript = JSON.parse(readFileSync(transcriptPath, 'utf-8')) as {
			messages?: Array<{
				type?: string;
				message?: {
					content?: Array<{ type?: string; text?: string }>;
				};
			}>;
		};

		if (!Array.isArray(transcript.messages)) {
			return undefined;
		}

		for (const message of transcript.messages.toReversed()) {
			if (message.type !== 'assistant') {
				continue;
			}

			const text =
				message.message?.content
					?.filter((content) => content.type === 'text' && typeof content.text === 'string')
					.map((content) => content.text)
					.join('')
					.trim() ?? '';

			if (text) {
				return text;
			}
		}
	} catch {
		return undefined;
	}

	return undefined;
}

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
		return typeof id === 'string' && id.includes('button');
	});

	return {
		score: calledForButton ? 0 : 1,
		description: DOCS_DESCRIPTION,
	};
};

const fromFinalResponseIncludesPreviewUrls: CalculateQualityFn = ({
	trialArgs,
}): QualityResult | undefined => {
	const finalAssistantText = extractFinalAssistantText(trialArgs.resultsPath);

	if (!finalAssistantText) {
		return {
			score: 0,
			description: FINAL_URLS_DESCRIPTION,
		};
	}

	const matchedCount = EXPECTED_PREVIEW_URL_PATTERNS.filter((pattern) =>
		pattern.test(finalAssistantText),
	).length;

	return {
		score: matchedCount / EXPECTED_PREVIEW_URL_PATTERNS.length,
		description: FINAL_URLS_DESCRIPTION,
	};
};

const hooks: Hooks = {
	calculateQuality: combine(
		[fromPreviewPathBasedInput, 0.5],
		[fromNoGetDocumentationForButton, 0.1],
		[fromFinalResponseIncludesPreviewUrls, 0.4],
	),
};

export default hooks;
