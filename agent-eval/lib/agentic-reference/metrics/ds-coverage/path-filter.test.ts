import { describe, expect, it } from 'vitest';

import { createPathFilter, describeUnmatchedGlob } from './path-filter.ts';

const ROOT = '/home/dev/storybook/code';

/** Filters are always built against a root; most tests do not care which. */
function filter(globs: string[], projectDir = ROOT) {
	return createPathFilter(globs, projectDir).isCounted;
}

describe('createPathFilter', () => {
	it('counts everything when given no globs', () => {
		const isCounted = filter([]);
		expect(isCounted('src/App.tsx')).toBe(true);
		expect(isCounted('anything/at/all.tsx')).toBe(true);
	});

	it('restricts to the positive globs once any is given', () => {
		const isCounted = filter(['src/**']);
		expect(isCounted('src/App.tsx')).toBe(true);
		expect(isCounted('src/deep/Nested.tsx')).toBe(true);
		expect(isCounted('other/Thing.tsx')).toBe(false);
	});

	it('excludes what a ! glob matches', () => {
		const isCounted = filter(['!core/src/components/**']);
		expect(isCounted('core/src/components/Button/Button.tsx')).toBe(false);
		expect(isCounted('core/src/manager/App.tsx')).toBe(true);
	});

	// A negative glob is not merely another vote: it settles the question, so
	// "everything under src except its debug corner" is one filter list. This is
	// also why negation is not handed to picomatch, which ORs a pattern list.
	it('lets a negative glob override a positive one', () => {
		const isCounted = filter(['src/**', '!src/debug/**']);
		expect(isCounted('src/App.tsx')).toBe(true);
		expect(isCounted('src/debug/Panel.tsx')).toBe(false);
		expect(isCounted('other/Thing.tsx')).toBe(false);
	});

	it('stops a single * at a path separator, where ** crosses it', () => {
		expect(filter(['src/*'])('src/App.tsx')).toBe(true);
		expect(filter(['src/*'])('src/deep/App.tsx')).toBe(false);
		expect(filter(['src/**'])('src/deep/App.tsx')).toBe(true);
	});

	it('lets a leading **/ match at the root as well as nested', () => {
		const isCounted = filter(['**/*.stories.tsx']);
		expect(isCounted('Button.stories.tsx')).toBe(true);
		expect(isCounted('src/deep/Button.stories.tsx')).toBe(true);
		expect(isCounted('src/Button.tsx')).toBe(false);
	});

	it('anchors both ends, so a glob is not a substring search', () => {
		const isCounted = filter(['src/App.tsx']);
		expect(isCounted('src/App.tsx')).toBe(true);
		expect(isCounted('vendor/src/App.tsx')).toBe(false);
		expect(isCounted('src/App.tsx.bak')).toBe(false);
	});

	it('holds a directory glob to a boundary rather than a prefix', () => {
		const isCounted = filter(['!packages/ui/**']);
		expect(isCounted('packages/ui/New.tsx')).toBe(false);
		expect(isCounted('packages/ui-legacy/Old.tsx')).toBe(true);
	});

	// What the dependency buys over the hand-rolled matcher it replaced.
	describe('full glob syntax', () => {
		it('supports brace expansion', () => {
			const isCounted = filter(['src/**/*.{tsx,jsx}']);
			expect(isCounted('src/a/App.tsx')).toBe(true);
			expect(isCounted('src/a/App.jsx')).toBe(true);
			expect(isCounted('src/a/App.ts')).toBe(false);
		});

		it('supports extglobs and character classes', () => {
			expect(filter(['src/!(debug)/**'])('src/main/App.tsx')).toBe(true);
			expect(filter(['src/!(debug)/**'])('src/debug/App.tsx')).toBe(false);
			expect(filter(['src/[A-Z]*.tsx'])('src/App.tsx')).toBe(true);
			expect(filter(['src/[A-Z]*.tsx'])('src/app.tsx')).toBe(false);
		});

		it('matches ? as exactly one character, separators excluded', () => {
			const isCounted = filter(['src/?.tsx']);
			expect(isCounted('src/A.tsx')).toBe(true);
			expect(isCounted('src/AB.tsx')).toBe(false);
		});

		// Off by default in picomatch, which would quietly skip a dot directory.
		it('matches dot directories', () => {
			expect(filter(['!.storybook/**'])('.storybook/preview.tsx')).toBe(false);
			expect(filter(['**/*.tsx'])('.config/thing.tsx')).toBe(true);
		});
	});

	// Both spellings of the same directory: the one you would paste from a
	// shell, and the one the report prints.
	describe('absolute globs', () => {
		it('rebases an absolute glob onto the project root', () => {
			const isCounted = filter([`!${ROOT}/core/src/components/**`]);
			expect(isCounted('core/src/components/Button/Button.tsx')).toBe(false);
			expect(isCounted('core/src/manager/App.tsx')).toBe(true);
		});

		it('gives the same answer as the relative spelling', () => {
			const paths = ['core/src/components/a.tsx', 'core/src/manager/b.tsx', 'addons/docs/c.tsx'];
			const relative = filter(['!core/src/components/**']);
			const absolute = filter([`!${ROOT}/core/src/components/**`]);
			for (const path of paths) expect(absolute(path), path).toBe(relative(path));
		});

		it('mixes absolute and relative globs in one list', () => {
			const isCounted = filter([`${ROOT}/src/**`, '!src/debug/**']);
			expect(isCounted('src/App.tsx')).toBe(true);
			expect(isCounted('src/debug/Panel.tsx')).toBe(false);
			expect(isCounted('other/Thing.tsx')).toBe(false);
		});

		it('resolves against a relative projectDir too', () => {
			const isCounted = createPathFilter([`${process.cwd()}/src/**`], '.').isCounted;
			expect(isCounted('src/App.tsx')).toBe(true);
			expect(isCounted('other/App.tsx')).toBe(false);
		});

		it('normalises a redundant absolute path', () => {
			const isCounted = filter([`!${ROOT}/core/./src/../src/components/**`]);
			expect(isCounted('core/src/components/a.tsx')).toBe(false);
			expect(isCounted('core/src/manager/a.tsx')).toBe(true);
		});

		// Silently matching nothing is the failure mode worth being loud about:
		// it reads as "there was nothing to exclude" rather than "wrong path".
		it('throws on an absolute glob outside the analyzed tree', () => {
			expect(() => filter(['!/somewhere/else/**'])).toThrow(/outside the analyzed tree/);
			expect(() => filter([`!${ROOT}/../sibling/**`])).toThrow(/outside the analyzed tree/);
		});

		it('throws on an absolute glob that is the tree itself', () => {
			expect(() => filter([`!${ROOT}`])).toThrow(/outside the analyzed tree/);
		});
	});

	// A glob matching nothing fails in two disguises — a negative one excludes
	// nothing and looks like "nothing to exclude", a positive one excludes
	// everything and looks like an empty tree. Neither announces itself.
	describe('unmatched', () => {
		const PATHS = ['core/src/components/Button.tsx', 'core/src/manager/App.tsx'];

		it('reports nothing when every glob found a file', () => {
			const found = createPathFilter(['!core/src/components/**'], ROOT).unmatched(PATHS);
			expect(found).toEqual([]);
		});

		it('reports a glob that matched no file, as it was written', () => {
			const found = createPathFilter(['!code/core/src/components/**'], ROOT).unmatched(PATHS);
			expect(found).toEqual(['!code/core/src/components/**']);
		});

		it('reports only the globs that missed', () => {
			const found = createPathFilter(
				['core/src/manager/**', 'nope/**', '!core/src/components/**', '!also-nope/**'],
				ROOT,
			).unmatched(PATHS);
			expect(found).toEqual(['nope/**', '!also-nope/**']);
		});

		it('reports nothing for an empty filter list', () => {
			expect(createPathFilter([], ROOT).unmatched(PATHS)).toEqual([]);
		});
	});
});

describe('describeUnmatchedGlob', () => {
	// The mistake worth naming: the path you would type from outside the tree,
	// one segment longer than the paths the census keys on.
	it('names the project directory when it was used as the first segment', () => {
		const message = describeUnmatchedGlob('!code/core/src/components/**', ROOT);
		expect(message).toContain("already 'code'");
		expect(message).toContain("Did you mean '!core/src/components/**'?");
	});

	it('keeps the ! off a suggestion for a positive glob', () => {
		const message = describeUnmatchedGlob('code/core/src/!(components)/**', ROOT);
		expect(message).toContain("Did you mean 'core/src/!(components)/**'?");
	});

	it('says only that it matched nothing when the cause is not guessable', () => {
		const message = describeUnmatchedGlob('!nonsense/**', ROOT);
		expect(message).toBe("filter '!nonsense/**' matched no files.");
	});

	// `code` alone is a plausible directory *inside* a project called code, so
	// there is nothing to strip and no suggestion to make.
	it('makes no suggestion for a single-segment glob', () => {
		expect(describeUnmatchedGlob('code', ROOT)).toBe("filter 'code' matched no files.");
	});
});
