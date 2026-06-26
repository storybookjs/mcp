import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the Storybook plugin skill files injected into each eval sandbox at
 * setup time, derived from the canonical plugin skills under `packages/`.
 *
 * The committed fixtures used to carry hand-edited copies of these skills, which
 * drifted from the shipped plugins. Instead we read the canonical SKILL.md, apply
 * the eval-only overlays (an invocation marker and a sandbox note) in code, and
 * `sandbox.writeFiles()` the result before the agent runs. The plugin packages
 * stay the single source of truth for skill *content*; only the eval
 * instrumentation lives here.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const CLAUDE_SKILLS_ROOT = 'packages/claude-plugin/skills';
const CODEX_SKILLS_ROOT = 'packages/codex-plugin/plugins/storybook/skills';

type SkillSource = {
	/** Skill name as it appears in the sandbox and in the eval marker. */
	name: string;
	/** Directory holding the canonical SKILL.md, relative to the repo root. */
	from: string;
	/** Inject the `.agent-eval/skills/<name>.json` invocation marker instruction. */
	marker?: boolean;
	/** Inject the eval-only preview browser mock instruction. */
	previewBrowserMock?: boolean;
	/** Inject the sandbox `require_escalated` note for Storybook CLI commands. */
	sandboxNote?: boolean;
};

type Surface = {
	/** Sandbox skills directory for this agent surface. */
	dir: string;
	/** `source` field written into eval markers for this surface. */
	markerSource: string;
	skills: SkillSource[];
};

const SURFACES: Surface[] = [
	{
		dir: '.claude/skills',
		markerSource: 'claude-skill',
		skills: [
			{ name: 'init', from: `${CLAUDE_SKILLS_ROOT}/storybook-init`, marker: true },
			{ name: 'setup', from: `${CLAUDE_SKILLS_ROOT}/storybook-setup` },
			{ name: 'upgrade', from: `${CLAUDE_SKILLS_ROOT}/storybook-upgrade` },
			{
				name: 'stories',
				from: `${CLAUDE_SKILLS_ROOT}/stories`,
				marker: true,
				previewBrowserMock: true,
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
		markerSource: 'codex-skill',
		skills: [
			{ name: 'init', from: `${CODEX_SKILLS_ROOT}/init`, marker: true },
			{ name: 'setup', from: `${CODEX_SKILLS_ROOT}/setup` },
			{ name: 'upgrade', from: `${CODEX_SKILLS_ROOT}/upgrade` },
			{
				name: 'stories',
				from: `${CODEX_SKILLS_ROOT}/stories`,
				marker: true,
				previewBrowserMock: true,
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

const PREVIEW_BROWSER_MOCK_SECTION = [
	'## Eval preview browser mock',
	'',
	'This Vercel Agent Eval sandbox does not expose the real Claude/Codex preview browser. ' +
		'When Storybook AI commands require a running preview, start the project Storybook dev script first.',
	'',
	'After Storybook is running and you have a preview URL, record the browser-open intent by running:',
	'',
	'```bash',
	'node .agent-eval/bin/open-preview-browser.mjs <storybook-preview-url>',
	'```',
	'',
	'Use the real Storybook URL you would open in the preview browser, for example ' +
		'`http://localhost:6006/?path=/story/components-badge--default`.',
	'',
	'This writes `.agent-eval/preview-browser.json`, which the eval harness scores as the preview browser signal.',
].join('\n');

function markerSection(name: string, source: string): string {
	return [
		'## Eval marker',
		'',
		'Before doing any other work, write a JSON marker so the eval harness can confirm this skill was invoked:',
		'',
		'```json',
		`{"skill":"${name}","source":"${source}","status":"invoked"}`,
		'```',
		'',
		`Save it to \`.agent-eval/skills/${name}.json\` (create the \`.agent-eval/skills\` directory if needed).`,
	].join('\n');
}

function splitFrontmatter(md: string): { frontmatter: string; body: string } {
	const match = md.match(/^---\n[\s\S]*?\n---\n/);
	return match
		? { frontmatter: match[0], body: md.slice(match[0].length) }
		: { frontmatter: '', body: md };
}

function renderSkill(skill: SkillSource, markerSource: string): string {
	const raw = readFileSync(resolve(REPO_ROOT, skill.from, 'SKILL.md'), 'utf-8');
	const { frontmatter, body } = splitFrontmatter(raw);
	const renamed = frontmatter.replace(/^name:.*$/m, `name: ${skill.name}`);

	const sections = [
		renamed.trim(),
		skill.marker ? markerSection(skill.name, markerSource) : '',
		skill.previewBrowserMock ? PREVIEW_BROWSER_MOCK_SECTION : '',
		skill.sandboxNote ? SANDBOX_SECTION : '',
		body.trim(),
	].filter(Boolean);

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
			files[`${surface.dir}/${skill.name}/SKILL.md`] = renderSkill(skill, surface.markerSource);
		}
	}
	return files;
}

export function storybookPreviewBrowserMockFiles(): Record<string, string> {
	return {
		'.agent-eval/bin/open-preview-browser.mjs': `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2];

if (!url) {
	console.error('Usage: node .agent-eval/bin/open-preview-browser.mjs <url>');
	process.exit(1);
}

try {
	new URL(url);
} catch {
	console.error(\`Invalid preview URL: \${url}\`);
	process.exit(1);
}

mkdirSync('.agent-eval', { recursive: true });
writeFileSync(
	'.agent-eval/preview-browser.json',
	JSON.stringify(
		{
			source: 'eval-preview-browser-mock',
			status: 'opened',
			url,
			openedAt: new Date().toISOString(),
		},
		null,
		2,
	),
);

console.log(\`Recorded preview browser open: \${url}\`);
`,
	};
}
