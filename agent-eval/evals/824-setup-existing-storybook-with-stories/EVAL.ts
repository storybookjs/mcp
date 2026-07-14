import { test } from 'vitest';
import {
	expectMcpAddonInstalled,
	expectNoStorybookAiSetup,
	expectStoryExportsExactly,
	expectStoryFilesExactly,
	expectStorybookBoots,
} from '#test-utils';

// The story gate of the setup decision tree (storybookjs/mcp#364): a setup
// request against a current Storybook that already has a user-written story
// in src/components must not run story generation — the agent ensures
// @storybook/addon-mcp (seeded absent) and starts Storybook instead. Same
// prompt as 820-init-no-storybook and 823-setup-outdated-storybook — only the
// seeded state differs. Which entry skill handles the request (setup vs
// stories) is deliberately not asserted; the story gate is the behavior under
// test.

test('does not run story generation on a project with user-written stories', () => {
	expectNoStorybookAiSetup();
});

test('does not add or remove story files', () => {
	expectStoryFilesExactly(['src/components/Button.stories.tsx']);
});

test('keeps the seeded story exports unchanged', () => {
	expectStoryExportsExactly('src/components/Button.stories.tsx', [
		'Primary',
		'Secondary',
		'Disabled',
	]);
});

test('installs and registers the MCP addon', () => {
	expectMcpAddonInstalled();
});

test('Storybook boots', async () => {
	await expectStorybookBoots();
});
