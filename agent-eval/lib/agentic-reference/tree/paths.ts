// Which files in a checked-out tree count as application source.
//
// Shared by the tree diff and the complexity baseline so the two can never
// disagree about what they are measuring.
//
// The vendored-directory rule is not hypothetical: Mealdrop checks in
// `.yarn/releases/yarn-4.2.1.cjs`, a 2MB minified bundle that alone accounted
// for 98% of the repository's total cyclomatic complexity (38951 of 39663).
// Nobody authored it and no agent will edit it.

/** Directories never worth walking: dependencies, build output, vendored tools. */
export const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.yarn',
	'.pnp',
	'.turbo',
	'.next',
	'dist',
	'build',
	'coverage',
	'vendor',
]);

/** Files whose contents are generated or minified rather than written. */
const GENERATED_FILE = /(?:\.min\.[cm]?jsx?|mockServiceWorker\.js)$/;

/**
 * Harness-injected files present in the collected tree that no agent authored.
 * Counting them would attribute several hundred lines of scaffolding to the run.
 */
export const EXCLUDED_PATHS = new Set([
	'EVAL.ts',
	'EVAL.tsx',
	'PROMPT.md',
	'post-analysis.ts',
	'.npmrc',
	'package.json',
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'vitest.config.ts',
	'vitest.config.app.ts',
]);

const EXCLUDED_PREFIXES = ['__agent_eval__/', '__metrics__/', '__analysis__/'];

/** Extensions the SLoC diff measures. */
export const SOURCE_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs|css)$/;

/** Extensions with an AST the complexity walkers can read. */
export const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;

export function isGenerated(path: string): boolean {
	return GENERATED_FILE.test(path);
}

/** Whether a workspace-relative path should be left out of every metric. */
export function isExcludedPath(path: string): boolean {
	if (EXCLUDED_PATHS.has(path)) return true;
	if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
	return isGenerated(path);
}
