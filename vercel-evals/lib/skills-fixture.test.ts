import { describe, expect, test } from 'vitest';
import {
	claudeMcpConfigFiles,
	storybookPreviewBrowserMockFiles,
	storybookSkillFiles,
} from './skills-fixture.ts';

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

	test('never injects an eval marker — invocation is detected from the transcript', () => {
		for (const content of Object.values(files)) {
			expect(content).not.toContain('## Eval marker');
			expect(content).not.toContain('.agent-eval/skills/');
			expect(content).not.toContain('open_preview_browser');
			expect(content).not.toContain('preview-browser MCP');
		}
	});

	test('adds the sandbox require_escalated note only to the stories skills', () => {
		expect(files['.claude/skills/stories/SKILL.md']).toContain('require_escalated');
		expect(files['.agents/skills/stories/SKILL.md']).toContain('require_escalated');
		expect(files['.claude/skills/setup/SKILL.md']).not.toContain('require_escalated');
	});
});

describe('storybookPreviewBrowserMockFiles', () => {
	const serverFiles = storybookPreviewBrowserMockFiles();

	test('emits a single stdio MCP server file', () => {
		expect(Object.keys(serverFiles)).toEqual(['.agent-eval/mcp/preview-browser-mock.mjs']);
	});

	test('exposes the preview tools and stays dependency-free', () => {
		const src = serverFiles['.agent-eval/mcp/preview-browser-mock.mjs'];
		for (const tool of ['preview_start', 'preview_screenshot', 'preview_snapshot', 'preview_inspect']) {
			expect(src).toContain(tool);
		}
		expect(src).toContain('tools/call');
		// Only node: built-ins — the sandbox project's node_modules may lack anything else.
		const imports = [...src.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
		expect(imports.length).toBeGreaterThan(0);
		expect(imports.every((mod) => mod.startsWith('node:'))).toBe(true);
	});
});

describe('claudeMcpConfigFiles', () => {
	test('registers the preview-browser server in a project .mcp.json', () => {
		const config = claudeMcpConfigFiles();
		expect(Object.keys(config)).toEqual(['.mcp.json']);

		const parsed = JSON.parse(config['.mcp.json']);
		expect(parsed.mcpServers['preview-browser']).toEqual({
			command: 'node',
			args: ['.agent-eval/mcp/preview-browser-mock.mjs'],
		});
	});
});
