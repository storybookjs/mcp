import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { CalculateQualityFn, Hooks, QualityResult } from '../../types.ts';
import { combine } from '../../lib/quality/index.ts';

const DESCRIPTION = 'Preview Input Strategy (Story ID)';
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
		[fromPreviewStoryIdInput, 0.5],
		[fromFinalResponseIncludesPreviewUrls, 0.4],
	),
};

export default hooks;
