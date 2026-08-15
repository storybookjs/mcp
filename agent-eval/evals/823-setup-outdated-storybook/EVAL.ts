import { test } from 'vitest';
import {
	expectMcpAddonInstalled,
	expectNoStorybookAiSetup,
	expectShellCommandMatching,
	expectSkillInvoked,
	expectStoryExportsExactly,
	expectStoryFilesExactly,
	expectStorybookBoots,
	expectStorybookDependenciesAtLeast,
} from '#test-utils';

// Regression fixture for a setup request against an already-installed but
// outdated Storybook (seeded 10.4.0, evals.pinStorybook: false) that already
// has user-written stories in src/components: the agent must notice the
// version is below the plugin requirement and route through the upgrade skill
// instead of setting up on the old version, and must then hit the setup
// decision tree's story gate (storybookjs/mcp#364) — ensure the MCP addon but
// skip story generation, because the project already has user-written
// stories. Same prompt as 820-init-no-storybook — only the seeded state
// differs. Which entry skill handles the request (setup vs stories) is
// deliberately not asserted; the upgrade routing and the story gate are the
// behavior under test.

test('routes to the storybook-upgrade skill', () => {
	expectSkillInvoked('storybook-upgrade');
});

test('runs the Storybook upgrade command', () => {
	expectShellCommandMatching(/storybook(@\S+)?\s+upgrade/);
});

// The plugin requires Storybook >= 10.5, so the seeded 10.4.0 must land at or
// above that — settling on the 10.4.x stable is exactly the bug this guards
// against. Prerelease specs like 10.5.0-beta.0 parse as (10,5,0) and satisfy
// the floor. Bump alongside future requirement changes.
test('upgrades the Storybook packages to the plugin-required release', () => {
	expectStorybookDependenciesAtLeast('10.5.0', ['storybook', '@storybook/react-vite'], {
		// Storybook 10 absorbs @storybook/react — a correct upgrade removes it,
		// but a stale seeded copy left behind must fail the floor.
		ifPresent: ['@storybook/react'],
	});
});

test('does not run story generation on a project with user-written stories', () => {
	expectNoStorybookAiSetup();
});

// Every component in src/components has a seeded story, so nothing is left
// to "fill in": any new story file is a genuine gate violation, not a
// defensible reading of the prompt's "preview the components in
// src/components". (Iteration 1 of the local runs showed Opus covering the
// then-storyless Tag component through the stories skill — reasonable
// behavior the eval must not punish.)
test('does not add or remove story files', () => {
	expectStoryFilesExactly(['src/components/Button.stories.tsx', 'src/components/Tag.stories.tsx']);
});

test('keeps the seeded story exports unchanged', () => {
	expectStoryExportsExactly('src/components/Button.stories.tsx', [
		'Primary',
		'Secondary',
		'Disabled',
	]);
	expectStoryExportsExactly('src/components/Tag.stories.tsx', ['Neutral', 'Positive', 'Notice']);
});

test('installs and registers the MCP addon', () => {
	expectMcpAddonInstalled();
});

test('the upgraded Storybook boots', async () => {
	await expectStorybookBoots();
});
