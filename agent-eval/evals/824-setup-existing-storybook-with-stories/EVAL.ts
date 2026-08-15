import { test } from 'vitest';
import {
	expectMcpAddonInstalled,
	expectNoStorybookAiSetup,
	expectStoryExportsExactly,
	expectStoryFilesExactly,
	expectStorybookBoots,
} from '#test-utils';

// The story gate of the setup decision tree (storybookjs/mcp#364): a setup
// request against a current Storybook that already has user-written stories
// in src/components must not run story generation — the agent ensures
// @storybook/addon-mcp (seeded absent) and starts Storybook instead. Same
// prompt as 820-init-no-storybook and 823-setup-outdated-storybook — only the
// seeded state differs. Which entry skill handles the request (setup vs
// stories) is deliberately not asserted; the story gate is the behavior under
// test.

test('does not run story generation on a project with user-written stories', () => {
	expectNoStorybookAiSetup();
});

// Every component in src/components has a seeded story, so nothing is left
// to "fill in": any new story file is a genuine gate violation, not a
// defensible reading of the prompt's "preview the components in
// src/components".
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

test('Storybook boots', async () => {
	await expectStorybookBoots();
});
