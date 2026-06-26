import {
	hasCommand,
	hasGeneratedFile,
	hasSkillInvocation,
	parseGeneratedJson,
} from '../evidence.ts';
import { binaryItem, defineScorer, totalScore } from '../types.ts';

const LOCAL_STORYBOOK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function isCodexAgent(agent: string): boolean {
	return agent.toLowerCase().split('/').includes('codex');
}

function isStorybookPreviewUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const pathAndSearch = `${url.pathname}${url.search}`;

		return (
			LOCAL_STORYBOOK_HOSTS.has(url.hostname) &&
			(url.port === '6006' ||
				pathAndSearch.includes('iframe.html') ||
				pathAndSearch.includes('/story/') ||
				pathAndSearch.includes('?path=/story/') ||
				pathAndSearch.toLowerCase().includes('storybook'))
		);
	} catch {
		return false;
	}
}

function previewBrowserMockUrl(marker: unknown): string | undefined {
	if (!marker || typeof marker !== 'object') return undefined;

	const record = marker as { source?: unknown; status?: unknown; url?: unknown };
	return record.source === 'eval-preview-browser-mock' &&
		record.status === 'opened' &&
		typeof record.url === 'string'
		? record.url
		: undefined;
}

export const storiesScorer = defineScorer({
	fixtureName: '923-skill-stories',
	threshold: 70,
	score({ runData, analysis, agent }) {
		const loadedStoryRules = hasCommand(analysis, /storybook(?:@[\w.-]+)?\s+ai\b/i);
		const startedStorybook = hasCommand(
			analysis,
			/(?:^|[\s'"])(?:npm\s+run\s+storybook|pnpm\s+(?:run\s+)?storybook|yarn\s+storybook|npx\s+storybook\s+dev|storybook\s+dev)(?=[\s'"]|$)/i,
		);
		const wroteStory = hasGeneratedFile(runData, /\.stories\.(t|j)sx?$/i);
		const previewMockUrl = previewBrowserMockUrl(
			parseGeneratedJson(runData, '.agent-eval/preview-browser.json'),
		);
		const openedRealBrowserPreview = analysis.workflow.browserUrls.some(isStorybookPreviewUrl);
		const openedMockPreview =
			startedStorybook && previewMockUrl !== undefined && isStorybookPreviewUrl(previewMockUrl);
		const openedPreview = openedRealBrowserPreview || openedMockPreview;
		const invokedStoriesSkill = hasSkillInvocation(analysis, 'stories');
		const isCodex = isCodexAgent(agent);
		const codexFollowedWorkflow = isCodex && loadedStoryRules && wroteStory && openedPreview;

		return totalScore([
			binaryItem(
				'loaded-story-rules',
				'Loaded story rules via the `storybook ai` CLI',
				0.3,
				loadedStoryRules,
			),
			binaryItem(
				'stories-skill',
				isCodex
					? 'Installed Codex stories skill and followed workflow'
					: 'Invoked the `stories` skill',
				0.2,
				invokedStoriesSkill || codexFollowedWorkflow,
				{ invokedStoriesSkill, codexFollowedWorkflow },
			),
			binaryItem('wrote-story-file', 'Wrote a `*.stories.*` file', 0.2, wroteStory),
			binaryItem(
				'opened-preview',
				'Opened the Storybook preview through the eval preview-browser mock',
				0.3,
				openedPreview,
				{
					browserUrls: analysis.workflow.browserUrls,
					openedMockPreview,
					openedRealBrowserPreview,
					previewMockUrl,
					startedStorybook,
				},
			),
		]);
	},
});
