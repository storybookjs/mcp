// Which files' JSX the census counts, from a list of glob patterns.
//
// Separate from package-pattern.ts because the two match different things: that
// one matches bare import specifiers against package patterns, this one matches
// file paths and so wants real glob semantics — globstars, braces, extglobs —
// which is picomatch's job rather than ours.
//
// A filtered-out file is still parsed and still resolves imports — it leaves the
// count, not the module graph. That is the whole point: a monorepo vendoring its
// own design system wants `!core/src/components/**` out of the app's UI total
// while every relative import into it keeps resolving.
import path from 'node:path';

import picomatch from 'picomatch';

import type { IsCountedFile } from './types.ts';

// The census keys files by workspace-relative path, and a leading dot is
// nothing special there: `.storybook/**` should mean what it says rather than
// silently matching nothing.
const MATCH_OPTIONS = { dot: true } as const;

/** Converts absolute path to project-root-relative. */
function toProjectRelative(glob: string, root: string): string {
	if (!path.isAbsolute(glob)) {
		return glob;
	}

	const relative = path.relative(root, glob);
	if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(
			`ds-coverage: filter '${glob}' is outside the analyzed tree (${root}), so it can never match. ` +
				'Pass a path inside it, or a pattern relative to it.',
		);
	}
	return relative.split(path.sep).join('/');
}

/**
 * A predicate over workspace-relative paths for a list of globs, matched by
 * picomatch.  A glob prefixed with `!` is negative. The two kinds compose
 * the way every filter list does:
 *
 * - no globs at all, and every file counts
 * - any positive glob, and a file has to match one of them
 * - any negative glob a file matches, and it is out regardless
 *
 * Negation is handled here rather than handed to picomatch: picomatch treats a
 * pattern list as a plain OR, under which one `!` pattern would match every
 * path the others excluded instead of vetoing them.
 */
export function createPathFilter(globs: string[], projectDir: string): IsCountedFile {
	const root = path.resolve(projectDir);
	const compiled = globs.map((glob) => {
		const negated = glob.startsWith('!');
		const pattern = toProjectRelative(negated ? glob.slice(1) : glob, root);
		return { glob, negated, matches: picomatch(pattern, MATCH_OPTIONS) };
	});

	const positive = compiled.filter((entry) => !entry.negated);
	const negative = compiled.filter((entry) => entry.negated);

	return (candidate) => {
		if (negative.some((entry) => entry.matches(candidate))) {
			return false;
		}

		return positive.length === 0 || positive.some((entry) => entry.matches(candidate));
	};
}
