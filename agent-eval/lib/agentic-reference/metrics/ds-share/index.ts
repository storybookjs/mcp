// How much of the app's UI comes from a design system.
//
// `analyzeDsShare` is the facade over three parts:
// - the module graph (module-graph.ts): what files exist, what they import
//   and export — framework-agnostic
// - the identification layer (identify.ts): what a name ultimately is,
//   following re-exports, barrels, and wrappers to the target — parameterized
//   by the DS package patterns, framework idioms supplied by a plugin
// - the census layer (react/census.ts): every JSX element, classified and
//   weighted — the framework-specific part
//
// Only the framework table below knows React exists; a future Vite-compatible
// framework adds an entry, not a refactor.
import { createResolver } from './identify.ts';
import { buildModuleGraph } from './module-graph.ts';
import { createPackageMatcher } from './package-pattern.ts';
import { censusReactTree } from './react/census.ts';
import { analyzeReactDeclaration } from './react/resolve.ts';
import { round } from '../../../utils/math.ts';

import type {
	CensusResult,
	DsShareOptions,
	DsShareReport,
	FrameworkImplementation,
} from './types.ts';

export type { DsShareOptions, DsShareReport, NodeTotals, UnresolvedElement } from './types.ts';

const FRAMEWORKS: Record<'react', FrameworkImplementation> = {
	react: {
		createDeclarationAnalyzer: () => analyzeReactDeclaration,
		census: censusReactTree,
	},
};

/** Shares are stored at 4 decimals: enough to compare runs, free of float noise. */
const SHARE_DIGITS = 4;

function share(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : round(numerator / denominator, SHARE_DIGITS);
}

function sortedComponents(census: CensusResult): DsShareReport['components'] {
	const entries = [...census.components.entries()].sort(
		(a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
	);
	return Object.fromEntries(entries);
}

/**
 * Measure the DS share of a source tree. Marker-free: `dsPackages` patterns
 * (e.g. `['@ds/*']`) are the only thing distinguishing DS code from the rest.
 */
export function analyzeDsShare(projectDir: string, options: DsShareOptions): DsShareReport {
	const framework = FRAMEWORKS[options.framework ?? 'react'];

	const graph = buildModuleGraph(projectDir);
	const isDsPackage = createPackageMatcher(options.dsPackages);
	const resolver = createResolver(graph, isDsPackage, framework.createDeclarationAnalyzer());
	const census = framework.census(graph, resolver);

	return {
		framework: options.framework ?? 'react',
		dsPackages: options.dsPackages,
		files: graph.files.size,
		parseFailures: graph.parseFailures,
		nodes: census.totals,
		dsShareOfAllNodes: share(census.totals.ds, census.totals.all),
		dsShareOfComponentNodes: share(census.totals.ds, census.totals.component),
		components: sortedComponents(census),
		unresolvedElements: census.unresolved,
		perFile: Object.fromEntries(census.perFile),
	};
}
