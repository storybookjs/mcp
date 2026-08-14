// How much of the app's UI comes from a design system.
//
// `analyzeDsCoverage` binds three layers together:
// * module-graph.ts: what files exist, what they import and export (framework-agnostic)
// * identify.ts:     which export names belong to the DS or not, following re-exports, barrel files,
//                    and wrappers to the target (framework-agnostic with framework plugins)
// * react/census.ts: how many component instances are DS names (react implementation)
import fs from 'node:fs';

import { share } from '#lib/utils/math';

import { createResolver } from './identify.ts';
import { buildModuleGraph } from './module-graph.ts';
import { createPackageMatcher } from './package-pattern.ts';
import { createPathFilter } from './path-filter.ts';
import { censusReactTree } from './react/census.ts';
import { analyzeReactDeclaration } from './react/resolve.ts';
import type {
	CensusResult,
	DsCoverageOptions,
	DsCoverageReport,
	FrameworkImplementation,
} from './types.ts';

const FRAMEWORKS: Record<'react', FrameworkImplementation> = {
	react: {
		createDeclarationAnalyzer: () => analyzeReactDeclaration,
		createCensus: () => censusReactTree,
	},
};

function sortedComponents(census: CensusResult): DsCoverageReport['components'] {
	const entries = [...census.components.entries()].sort(
		(a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
	);
	return Object.fromEntries(entries);
}

/**
 * Measures the DS share of a source tree. Uses import patterns
 * (e.g. `['@ds/*']`) to distinguish DS code from the rest.
 */
export function analyzeDsCoverage(options: DsCoverageOptions): DsCoverageReport {
	const framework = FRAMEWORKS[options.framework ?? 'react'];
	if (!framework) {
		throw new Error(`Unsupported framework: ${options.framework}`);
	}

	if (!fs.existsSync(options.projectDir)) {
		throw new Error(`Project directory does not exist: ${options.projectDir}`);
	}
	if (!fs.statSync(options.projectDir).isDirectory()) {
		throw new Error(`Project directory is not a directory: ${options.projectDir}`);
	}

	const censusInclude = options.censusInclude ?? [];
	const censusExclude = options.censusExclude ?? [];
	const graph = buildModuleGraph(options.projectDir);
	const isDsPackage = createPackageMatcher(options.dsPackages);
	const resolver = createResolver(graph, isDsPackage, framework.createDeclarationAnalyzer());
	// We use the projectDir as a working directory to resolve relative paths in filters.
	const isCounted = createPathFilter(censusInclude, censusExclude, options.projectDir);
	const includeNodes = options.includeNodes ?? false;
	const census = framework.createCensus()(graph, resolver, isCounted, includeNodes);

	return {
		framework: options.framework ?? 'react',
		dsPackages: options.dsPackages,
		censusInclude,
		censusExclude,
		files: [...graph.files.keys()].filter(isCounted).length,
		parseFailures: graph.parseFailures,
		readFailures: graph.readFailures,
		nodes: census.totals,
		dsShareOfAllNodes: share(census.totals.ds, census.totals.all),
		dsShareOfComponentNodes: share(census.totals.ds, census.totals.component),
		components: sortedComponents(census),
		unresolvedElements: census.unresolved,
		perFile: Object.fromEntries(census.perFile),
		// Spread rather than assign: the key has to be *absent*, not undefined, or
		// every stored baseline would gain a key it never had.
		...(includeNodes ? { nodeList: census.nodes ?? [] } : {}),
	};
}
