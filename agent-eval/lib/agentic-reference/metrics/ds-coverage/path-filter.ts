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

/**
 * A glob in the terms the census matches: relative to the project root, with
 * `/` separators.
 *
 * Absolute globs are rebased so that both spellings of the same directory work
 * — the path you would paste from a shell and the path the report prints. One
 * that points outside the tree throws rather than matching nothing, because a
 * filter that silently selects zero files reads as "nothing to exclude here".
 */
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

export interface PathFilter {
	/** Whether a file's JSX counts toward the census. */
	isCounted: IsCountedFile;
	/**
	 * The globs that matched none of `paths`, as the caller wrote them.
	 *
	 * A glob matching nothing is never what someone meant, and it fails in two
	 * different disguises: a negative one quietly excludes nothing and reads as
	 * "there was nothing to exclude", a positive one excludes *everything* and
	 * reads as an empty tree. Neither announces itself, so the caller asks.
	 */
	unmatched(paths: Iterable<string>): string[];
}

/**
 * A predicate over workspace-relative paths for a list of globs, matched by
 * picomatch — so braces, extglobs and character classes all work.
 *
 * A glob prefixed with `!` is negative. The two kinds compose the way every
 * filter list does:
 *
 * - no globs at all, and every file counts
 * - any positive glob, and a file has to match one of them
 * - any negative glob a file matches, and it is out regardless
 *
 * So `!core/src/components/**` counts the whole tree except that directory,
 * `core/src/manager/**` counts only the manager, and passing both counts the
 * manager minus anything of it that lives under components.
 *
 * Negation is handled here rather than handed to picomatch: picomatch treats a
 * pattern list as a plain OR, under which one `!` pattern would match every
 * path the others excluded instead of vetoing them.
 */
export function createPathFilter(globs: string[], projectDir: string): PathFilter {
	const root = path.resolve(projectDir);
	const compiled = globs.map((glob) => {
		const negated = glob.startsWith('!');
		const pattern = toProjectRelative(negated ? glob.slice(1) : glob, root);
		return { glob, negated, matches: picomatch(pattern, MATCH_OPTIONS) };
	});

	const positive = compiled.filter((entry) => !entry.negated);
	const negative = compiled.filter((entry) => entry.negated);

	return {
		isCounted: (candidate) => {
			if (negative.some((entry) => entry.matches(candidate))) return false;
			return positive.length === 0 || positive.some((entry) => entry.matches(candidate));
		},
		unmatched: (paths) => {
			const live = new Set(compiled);
			for (const candidate of paths) {
				for (const entry of live) {
					if (entry.matches(candidate)) live.delete(entry);
				}
				if (live.size === 0) break;
			}
			return [...live].map((entry) => entry.glob);
		},
	};
}

/**
 * Why a glob found nothing, when the answer is guessable. Passing the project
 * directory's own name as the first segment is the mistake worth naming: the
 * path you would type from outside the tree, one segment longer than the paths
 * the census actually keys on.
 */
export function describeUnmatchedGlob(glob: string, projectDir: string): string {
	const negated = glob.startsWith('!');
	const pattern = negated ? glob.slice(1) : glob;
	const [first, ...rest] = pattern.split('/');
	if (rest.length === 0 || first !== path.basename(path.resolve(projectDir))) {
		return `filter '${glob}' matched no files.`;
	}
	return (
		`filter '${glob}' matched no files: globs are relative to the project root, ` +
		`which is already '${first}'. Did you mean '${negated ? '!' : ''}${rest.join('/')}'?`
	);
}
