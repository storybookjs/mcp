import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function read(path: string): string {
	return readFileSync(path, 'utf-8');
}

function readTranscriptContext(): {
	o11y?: {
		shellCommands?: Array<{ command: string }>;
	} | null;
} {
	try {
		return JSON.parse(read('__agent_eval__/results.json'));
	} catch {
		return {};
	}
}

function readSkillMarker(skill: string): { skill?: unknown; status?: unknown } {
	return JSON.parse(read(`.agent-eval/skills/${skill}.json`)) as {
		skill?: unknown;
		status?: unknown;
	};
}

const STORYBOOK_PLUGIN_SKILLS = ['init', 'setup', 'stories', 'upgrade'];

describe('storybook plugin skills', () => {
	test('are available for both agent surfaces', () => {
		for (const skill of STORYBOOK_PLUGIN_SKILLS) {
			expect(existsSync(`.agents/skills/${skill}/SKILL.md`)).toBe(true);
			expect(existsSync(`.claude/skills/${skill}/SKILL.md`)).toBe(true);
		}
	});
});

describe('component and stories case', () => {
	test('badge component was changed into a pill', () => {
		const badge = read('src/components/Badge.tsx');
		expect(badge).toMatch(/borderRadius|rounded|pill|9999|999px/i);
		expect(badge).toMatch(/padding|inline-flex|inlineBlock|inline-block/i);
	});
});

describe('stories workflow', () => {
	test('badge story file was added', () => {
		const candidates = ['src/Badge.stories.tsx', 'src/components/Badge.stories.tsx'];
		const storyPath = candidates.find((candidate) => existsSync(candidate));
		expect(storyPath).toBeTruthy();
		const story = read(storyPath!);
		expect(story).toMatch(/Badge/);
		expect(story).toMatch(/neutral/i);
		expect(story).toMatch(/success|danger/i);
	});

	test('stories skill was invoked', () => {
		expect(existsSync('.agent-eval/skills/stories.json')).toBe(true);
		const marker = readSkillMarker('stories');

		expect(marker.skill).toBe('stories');
		expect(marker.status).toBe('invoked');
	});

	test('agent used Storybook AI CLI workflow', () => {
		const context = readTranscriptContext();
		const commands = context.o11y?.shellCommands?.map(({ command }) => command) ?? [];
		const aiCliHelpIndex = commands.findIndex((command) =>
			/(^|\s)STORYBOOK_FEATURE_AI_CLI=1\s+npx\s+storybook\s+ai\s+--help\b/i.test(command),
		);
		const previewStoriesIndex = commands.findIndex((command) =>
			/(^|\s)STORYBOOK_FEATURE_AI_CLI=1\s+npx\s+storybook\s+ai\s+preview-stories\b/i.test(command),
		);

		expect(aiCliHelpIndex).toBeGreaterThanOrEqual(0);
		expect(previewStoriesIndex).toBeGreaterThan(aiCliHelpIndex);
	});
});
