import { binaryItem, defineScorer, totalScore } from '../types';
import { hasCommand, hasGeneratedFile, hasSkillInvocation } from '../evidence';

export const storiesScorer = defineScorer({
	fixtureName: '923-skill-stories',
	score({ runData, analysis, agent }) {
		const loadedStoryRules = hasCommand(analysis, /storybook(?:@[\w.-]+)?\s+ai\b/i);
		const wroteStory = hasGeneratedFile(runData, /\.stories\.(t|j)sx?$/i);
		const openedPreview = hasCommand(analysis, /storybook(?:@[\w.-]+)?\s+ai\s+preview-stories\b/i);
		const invokedStoriesSkill = hasSkillInvocation(analysis, 'stories');
		const codexFollowedWorkflow =
			agent === 'codex' && loadedStoryRules && wroteStory && openedPreview;

		return totalScore([
			binaryItem(
				'loaded-story-rules',
				'Loaded story rules via the `storybook ai` CLI',
				0.3,
				loadedStoryRules,
			),
			binaryItem(
				'stories-skill',
				agent === 'codex'
					? 'Installed Codex stories skill and followed workflow'
					: 'Invoked the `stories` skill',
				0.2,
				invokedStoriesSkill || codexFollowedWorkflow,
				{ invokedStoriesSkill, codexFollowedWorkflow },
			),
			binaryItem('wrote-story-file', 'Wrote a `*.stories.*` file', 0.2, wroteStory),
			binaryItem('opened-preview', 'Opened a preview via `preview-stories`', 0.3, openedPreview),
		]);
	},
});
