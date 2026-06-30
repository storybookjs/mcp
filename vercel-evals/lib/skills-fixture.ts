import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the Storybook plugin skill files injected into each eval sandbox, read live
 * from the canonical skills under `packages/` with one eval-only overlay: a sandbox
 * `require_escalated` note. Also ships a mock MCP server that simulates the preview
 * browser — a native capability the sandbox lacks — so the agent can open the
 * Storybook preview. The injected skills do not mention the mock.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

const CLAUDE_SKILLS_ROOT = 'packages/claude-plugin/skills';
const CODEX_SKILLS_ROOT = 'packages/codex-plugin/plugins/storybook/skills';

/** Sandbox-relative path the mock MCP server is written to. */
export const PREVIEW_BROWSER_MOCK_PATH = '.agent-eval/mcp/preview-browser-mock.mjs';

/** MCP server name; kept recognizable as a browser tool so scoring can detect its calls. */
export const PREVIEW_BROWSER_MCP_SERVER_NAME = 'preview-browser';

/** The real MCP server source (`lib/mcp/`), shipped verbatim into the sandbox. */
const MCP_SERVER_SOURCE_FILE = resolve(HERE, 'mcp/preview-browser-mock.mjs');

type SkillSource = {
	/** Skill name as it appears in the sandbox. */
	name: string;
	/** Directory holding the canonical SKILL.md, relative to the repo root. */
	from: string;
	/** Inject the sandbox `require_escalated` note for Storybook CLI commands. */
	sandboxNote?: boolean;
};

type Surface = {
	/** Sandbox skills directory for this agent surface. */
	dir: string;
	skills: SkillSource[];
};

const SURFACES: Surface[] = [
	{
		dir: '.claude/skills',
		skills: [
			{ name: 'init', from: `${CLAUDE_SKILLS_ROOT}/storybook-init` },
			{ name: 'setup', from: `${CLAUDE_SKILLS_ROOT}/storybook-setup` },
			{ name: 'upgrade', from: `${CLAUDE_SKILLS_ROOT}/storybook-upgrade` },
			{
				name: 'stories',
				from: `${CLAUDE_SKILLS_ROOT}/stories`,
				sandboxNote: true,
			},
			{
				name: 'storybook-setup-claude-launch',
				from: `${CLAUDE_SKILLS_ROOT}/storybook-setup-claude-launch`,
			},
		],
	},
	{
		dir: '.agents/skills',
		skills: [
			{ name: 'init', from: `${CODEX_SKILLS_ROOT}/init` },
			{ name: 'setup', from: `${CODEX_SKILLS_ROOT}/setup` },
			{ name: 'upgrade', from: `${CODEX_SKILLS_ROOT}/upgrade` },
			{
				name: 'stories',
				from: `${CODEX_SKILLS_ROOT}/stories`,
				sandboxNote: true,
			},
		],
	},
];

const SANDBOX_SECTION = [
	'## Sandbox',
	'',
	'In sandboxed environments, run any Storybook CLI command with `require_escalated` ' +
		'(sandbox/network permissions may otherwise prevent localhost access).',
].join('\n');

function splitFrontmatter(md: string): { frontmatter: string; body: string } {
	const match = md.match(/^---\n[\s\S]*?\n---\n/);
	return match
		? { frontmatter: match[0], body: md.slice(match[0].length) }
		: { frontmatter: '', body: md };
}

function renderSkill(skill: SkillSource): string {
	const raw = readFileSync(resolve(REPO_ROOT, skill.from, 'SKILL.md'), 'utf-8');
	const { frontmatter, body } = splitFrontmatter(raw);
	const renamed = frontmatter.replace(/^name:.*$/m, `name: ${skill.name}`);

	const sections = [renamed.trim(), skill.sandboxNote ? SANDBOX_SECTION : '', body.trim()].filter(
		Boolean,
	);

	return `${sections.join('\n\n')}\n`;
}

/**
 * Returns a sandbox-relative path -> contents map of the Storybook plugin skills
 * for both agent surfaces, ready to hand to `sandbox.writeFiles()`.
 */
export function storybookSkillFiles(): Record<string, string> {
	const files: Record<string, string> = {};
	for (const surface of SURFACES) {
		for (const skill of surface.skills) {
			files[`${surface.dir}/${skill.name}/SKILL.md`] = renderSkill(skill);
		}
	}
	return files;
}

/** The mock preview-browser MCP server file, for both agent surfaces. */
export function storybookPreviewBrowserMockFiles(): Record<string, string> {
	return {
		[PREVIEW_BROWSER_MOCK_PATH]: readFileSync(MCP_SERVER_SOURCE_FILE, 'utf-8'),
	};
}

/**
 * Project-scoped `.mcp.json` registering the mock server for Claude Code, which
 * auto-loads it under `--dangerously-skip-permissions`. Avoids `claude mcp add`,
 * which can't run in setup — the harness installs the CLI afterward.
 */
export function claudeMcpConfigFiles(): Record<string, string> {
	return {
		'.mcp.json': `${JSON.stringify(
			{
				mcpServers: {
					[PREVIEW_BROWSER_MCP_SERVER_NAME]: {
						command: 'node',
						args: [PREVIEW_BROWSER_MOCK_PATH],
					},
				},
			},
			null,
			2,
		)}\n`,
	};
}
