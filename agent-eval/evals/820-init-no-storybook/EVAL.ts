import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
	expectDependencyInstalled,
	expectMcpAddonInstalled,
	expectShellCommandMatching,
	expectSkillInvoked,
	expectStorybookAiSetupRan,
	expectStorybookBoots,
	isRecord,
	parseJson,
} from '#test-utils';

// Lifecycle and routing assertions only: the storybook-init skill installs
// the published stable release, so whatever `storybook ai setup` prints and
// does afterwards (story generation, review) is release behavior, not this
// repo's code — that workflow is owned by the 80x evals. The routing itself
// is local skill text (storybookjs/mcp#364): init hands back to the setup
// decision tree, and a fresh init leaves only example stories, so the tree
// must reach the no-user-stories branch and run `npx storybook ai setup`.

test('invokes the storybook-init skill', () => {
	expectSkillInvoked('storybook-init');
});

// Loose match: `npm create storybook@latest`, the package-manager
// equivalents, and the `storybook init` alias all count.
test('runs the Storybook initializer', () => {
	expectShellCommandMatching(/create(-|\s+)storybook|storybook(@\S+)?\s+init/);
});

test('installs Storybook', () => {
	expectDependencyInstalled('storybook');

	const packageJson = parseJson(readFileSync('package.json', 'utf8'));
	const scripts = isRecord(packageJson) && isRecord(packageJson.scripts) ? packageJson.scripts : {};
	expect(scripts.storybook, 'Expected a storybook script').toBeTypeOf('string');
});

test('installs and registers the MCP addon', () => {
	expectMcpAddonInstalled();
});

test('installs the vitest addon for the story-less setup branch', () => {
	expectDependencyInstalled(
		'@storybook/addon-vitest',
		'setup skill: npx storybook add @storybook/addon-vitest',
	);
});

test('runs story generation setup on the story-less project', () => {
	expectStorybookAiSetupRan();
});

test('the initialized Storybook boots', async () => {
	await expectStorybookBoots();
});
