// Standalone axe-core injection.
//
// Deliberately NOT @axe-core/playwright: we read the library's own bundle off
// disk and inject the source into the page, then call axe.run() in-page. That
// keeps the driver (Playwright) and the analyser (axe-core) independent, so the
// same journey code could be pointed at any CDP-speaking runtime later.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Resolve axe-core's minified bundle from a given node_modules root.
 * `from` is any path inside the tree whose node_modules should be searched.
 */
export function resolveAxeSource(from) {
	const require = createRequire(join(from, 'noop.js'));
	const pkgPath = require.resolve('axe-core/package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	const file = join(dirname(pkgPath), 'axe.min.js');
	return { source: readFileSync(file, 'utf8'), version: pkg.version, file };
}

/**
 * Register axe on the page so it survives navigations and is present in every
 * new document. addInitScript runs before any page script, so a journey can
 * scan at any point without a further round trip.
 */
export async function installAxe(page, axeSource) {
	await page.addInitScript({ content: axeSource });
}

/** Default scan configuration. Kept explicit so runs are comparable. */
export const DEFAULT_AXE_OPTIONS = {
	// WCAG 2.0/2.1 A + AA, plus axe's own best-practice pack. Naming the tags
	// rather than taking axe's defaults means an axe-core upgrade that adds a
	// new tag does not silently change the metric.
	runOnly: {
		type: 'tag',
		values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
	},
	resultTypes: ['violations', 'incomplete'],
};

/**
 * Run axe in-page and return a trimmed, JSON-safe result.
 *
 * axe's raw output carries every passing node, which for this app is ~1MB per
 * scan; we keep counts for passes and full detail only for violations.
 */
export async function runAxe(page, options = DEFAULT_AXE_OPTIONS) {
	return page.evaluate(async (opts) => {
		if (typeof globalThis.axe === 'undefined') {
			throw new TypeError('axe-core was not injected into this page');
		}

		const results = await globalThis.axe.run(document, opts);

		const trim = (nodes) =>
			nodes.slice(0, 20).map((node) => ({
				target: node.target,
				html: String(node.html).slice(0, 300),
				failureSummary: node.failureSummary ? String(node.failureSummary).slice(0, 500) : null,
			}));

		return {
			testEngine: results.testEngine,
			url: results.url,
			violations: results.violations.map((v) => ({
				id: v.id,
				impact: v.impact,
				help: v.help,
				tags: v.tags,
				nodeCount: v.nodes.length,
				nodes: trim(v.nodes),
			})),
			incomplete: results.incomplete.map((v) => ({
				id: v.id,
				impact: v.impact,
				nodeCount: v.nodes.length,
			})),
			// Rule ids on every bucket, not just counts: "which rules could even
			// run here" is the first question to ask of any headless a11y setup,
			// and a bare pass count cannot answer it.
			passes: results.passes.map((r) => r.id),
			passCount: results.passes.length,
			inapplicableCount: results.inapplicable.length,
			inapplicable: results.inapplicable.map((r) => r.id),
		};
	}, options);
}

/** Total failing DOM nodes across all violated rules. */
export function totalNodes(violations) {
	return violations.reduce((sum, v) => sum + v.nodeCount, 0);
}
