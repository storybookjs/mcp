import { collectClaudeLaunchConfigs, parseGeneratedJson } from '../evidence.ts';
import { binaryItem, defineScorer, totalScore } from '../types.ts';

export const storybookSetupClaudeLaunchScorer = defineScorer({
	fixtureName: '922-skill-storybook-setup-claude-launch',
	threshold: 100,
	score({ runData }) {
		const launchJson = parseGeneratedJson(runData, '.claude/launch.json');
		const configs = collectClaudeLaunchConfigs(launchJson);
		const storybook = configs.find((config) => config.name === 'Storybook');

		return totalScore([
			binaryItem(
				'storybook-launch-auto-port',
				'Storybook launch entry exists with autoPort: true',
				1,
				storybook?.autoPort === true,
				storybook ? { command: storybook.command, autoPort: storybook.autoPort } : undefined,
			),
		]);
	},
});
