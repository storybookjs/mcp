import { describe, expect, test } from 'vitest';
import { storybookPreviewBrowserMockFiles, storybookSkillFiles } from './skills-fixture.ts';

const files = storybookSkillFiles();

function frontmatterName(content: string): string | undefined {
	return content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
}

describe('storybookSkillFiles', () => {
	test('emits both agent surfaces with the expected skill set', () => {
		expect(Object.keys(files).sort()).toEqual(
			[
				'.agents/skills/init/SKILL.md',
				'.agents/skills/setup/SKILL.md',
				'.agents/skills/stories/SKILL.md',
				'.agents/skills/upgrade/SKILL.md',
				'.claude/skills/init/SKILL.md',
				'.claude/skills/setup/SKILL.md',
				'.claude/skills/stories/SKILL.md',
				'.claude/skills/storybook-setup-claude-launch/SKILL.md',
				'.claude/skills/upgrade/SKILL.md',
			].sort(),
		);
	});

	test('rewrites frontmatter name to match the sandbox skill directory', () => {
		for (const [path, content] of Object.entries(files)) {
			const dir = path.split('/').at(-2);
			expect(content.startsWith('---\n')).toBe(true);
			expect(frontmatterName(content)).toBe(dir);
		}
	});

	test('keeps canonical skill content (sourced from packages/, not hand-copied)', () => {
		expect(files['.claude/skills/stories/SKILL.md']).toMatch(/Storybook CLI ai subcommands/);
		// Current canonical stories workflow routes preview through the launcher.
		expect(files['.claude/skills/stories/SKILL.md']).toMatch(/launch\.json/);
	});

	test.each([
		['.claude/skills/init/SKILL.md', 'init', 'claude-skill'],
		['.claude/skills/stories/SKILL.md', 'stories', 'claude-skill'],
		['.agents/skills/init/SKILL.md', 'init', 'codex-skill'],
		['.agents/skills/stories/SKILL.md', 'stories', 'codex-skill'],
	])('injects an invocation marker into %s', (path, name, source) => {
		const content = files[path];
		expect(content).toContain(`{"skill":"${name}","source":"${source}","status":"invoked"}`);
		expect(content).toContain(`.agent-eval/skills/${name}.json`);
	});

	test.each([
		'.claude/skills/setup/SKILL.md',
		'.claude/skills/upgrade/SKILL.md',
		'.claude/skills/storybook-setup-claude-launch/SKILL.md',
		'.agents/skills/setup/SKILL.md',
		'.agents/skills/upgrade/SKILL.md',
	])('does not add a marker to %s', (path) => {
		expect(files[path]).not.toContain('## Eval marker');
	});

	test('adds the sandbox require_escalated note only to the stories skills', () => {
		expect(files['.claude/skills/stories/SKILL.md']).toContain('require_escalated');
		expect(files['.agents/skills/stories/SKILL.md']).toContain('require_escalated');
		expect(files['.claude/skills/setup/SKILL.md']).not.toContain('require_escalated');
	});

	test('adds the eval preview browser mock only to the stories skills', () => {
		expect(files['.claude/skills/stories/SKILL.md']).toContain(
			'start the project Storybook dev script first',
		);
		expect(files['.agents/skills/stories/SKILL.md']).toContain(
			'node .agent-eval/bin/open-preview-browser.mjs <storybook-preview-url>',
		);
		expect(files['.claude/skills/setup/SKILL.md']).not.toContain('open-preview-browser');
	});
});

describe('storybookPreviewBrowserMockFiles', () => {
	test('emits the preview browser marker command', () => {
		const mockFiles = storybookPreviewBrowserMockFiles();

		expect(Object.keys(mockFiles)).toEqual(['.agent-eval/bin/open-preview-browser.mjs']);
		expect(mockFiles['.agent-eval/bin/open-preview-browser.mjs']).toContain(
			'.agent-eval/preview-browser.json',
		);
		expect(mockFiles['.agent-eval/bin/open-preview-browser.mjs']).toContain(
			'eval-preview-browser-mock',
		);
	});
});
