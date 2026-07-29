import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { importModule, normalizeStoryPath } from 'storybook/internal/common';
import pkg from '../package.json' with { type: 'json' };

// semver is a transitive dependency of storybook; it is loaded here only to
// evaluate the published peer range against concrete storybook versions.
const { satisfies } = createRequire(import.meta.url)('semver') as {
	satisfies: (version: string, range: string) => boolean;
};

const storybookRange = pkg.peerDependencies.storybook;

describe('storybook peer dependency range', () => {
	it('excludes storybook 9.1.x, where the preset fails to load', () => {
		// storybook 9.1.x does not export `importModule` from
		// `storybook/internal/common`, so preset loading crashes with
		// "Unexpected module status 0". See #376.
		expect(satisfies('9.1.16', storybookRange)).toBe(false);
		expect(satisfies('9.1.20', storybookRange)).toBe(false);
	});

	it('admits the storybook 10.x lines that provide the exports the preset needs', () => {
		for (const version of ['10.0.0', '10.1.11', '10.2.14', '10.3.5', '10.4.2', '10.5.3']) {
			expect(satisfies(version, storybookRange), `expected range to admit ${version}`).toBe(true);
		}
	});

	it('still admits storybook canaries', () => {
		expect(satisfies('0.0.0-pr-123-abc', storybookRange)).toBe(true);
	});

	it('keeps the @storybook/addon-vitest range in lockstep with the storybook range', () => {
		expect(pkg.peerDependencies['@storybook/addon-vitest']).toBe(storybookRange);
	});

	it('finds the storybook/internal/common exports the preset imports', () => {
		// Behavioral anchor for the range floor: these are the exports the
		// preset's load path pulls from `storybook/internal/common`, and
		// `importModule` is the one missing on the excluded 9.1.x line.
		expect(typeof importModule).toBe('function');
		expect(typeof normalizeStoryPath).toBe('function');
	});
});
