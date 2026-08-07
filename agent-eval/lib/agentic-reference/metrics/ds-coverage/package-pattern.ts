// Which bare import specifiers belong to the design system.
//
// The DS is named by package *patterns* (`@ds/*`, `@base-ui/react`), matched
// against the package name of a specifier — not the full specifier — so that
// subpath imports (`@base-ui/react/button`) classify with their package.

/** The package-name half of a bare specifier: `@scope/name` or `name`. */
export function packageNameOf(specifier: string): string {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

/**
 * A predicate over bare specifiers for a list of package patterns. `*` matches
 * within one path segment (`@ds/*` matches `@ds/button`, not `@dsx/button`);
 * everything else is literal.
 */
export function createPackageMatcher(patterns: string[]): (specifier: string) => boolean {
	const matchers = patterns.map((pattern) => {
		const source = pattern
			.split('*')
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*');
		return new RegExp(`^${source}$`);
	});

	return (specifier) => {
		const packageName = packageNameOf(specifier);
		return matchers.some((matcher) => matcher.test(packageName));
	};
}
