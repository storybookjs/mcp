// Which bare import specifiers belong to the design system.
//
// The DS is named by import *patterns* (`@ds/*`, `@base-ui/react`,
// `storybook/internal/components`), matched against a specifier as a prefix
// ending on a path boundary. That covers both shapes a design system ships in:
// a package whose subpaths are all DS (`@base-ui/react/button`), and a package
// that exposes its DS at one subpath among many — `storybook/internal/components`
// is the design system, `storybook/internal/types` is not.

/** The package-name half of a bare specifier: `@scope/name` or `name`. */
export function packageNameOf(specifier: string): string {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

/**
 * A predicate over bare specifiers for a list of import patterns. `*` matches
 * within one path segment (`@ds/*` matches `@ds/button`, not `@dsx/button`);
 * everything else is literal.
 *
 * A pattern matches a specifier that *is* it, or that continues it after a `/`:
 * `@base-ui/react` covers `@base-ui/react/button` but not `@base-ui/react-extras`.
 * Anchoring on the boundary rather than reducing the specifier to its package
 * name is what lets a pattern name a subpath at all — reduced first, a
 * `storybook/internal/components` pattern would be compared against the bare
 * `storybook` and never match anything, including itself.
 */
export function createPackageMatcher(patterns: string[]): (specifier: string) => boolean {
	const matchers = patterns.map((pattern) => {
		const source = pattern
			.split('*')
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*');
		return new RegExp(`^${source}(?:/|$)`);
	});

	return (specifier) => matchers.some((matcher) => matcher.test(specifier));
}
