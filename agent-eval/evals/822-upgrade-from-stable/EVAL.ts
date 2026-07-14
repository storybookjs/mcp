import { test } from 'vitest';
import {
	expectShellCommandMatching,
	expectSkillInvoked,
	expectStorybookBoots,
	expectStorybookDependenciesAtLeast,
} from '#test-utils';

// Only the lifecycle outcome is asserted; the story/review workflow is owned
// by the 80x evals. The fixture opts out of the harness version pinning
// (evals.pinStorybook: false) to keep the seeded 10.4.0.

test('invokes the storybook-upgrade skill', () => {
	expectSkillInvoked('storybook-upgrade');
});

test('runs the Storybook upgrade command', () => {
	expectShellCommandMatching(/storybook(@\S+)?\s+upgrade/);
});

// The plugin requires Storybook >= 10.5.2, so the seeded 10.4.0 must land at
// or above that — settling on the 10.4.x stable is exactly the bug this
// guards against. Prerelease specs like 10.5.2-beta.0 parse as (10,5,2) and
// satisfy the floor. Bump alongside future requirement changes.
test('upgrades the Storybook packages to the plugin-required release', () => {
	expectStorybookDependenciesAtLeast('10.5.2', ['storybook', '@storybook/react-vite'], {
		// Storybook 10 absorbs @storybook/react — a correct upgrade removes it,
		// but a stale seeded copy left behind must fail the floor.
		ifPresent: ['@storybook/react'],
	});
});

test('the upgraded Storybook boots', async () => {
	await expectStorybookBoots();
});
