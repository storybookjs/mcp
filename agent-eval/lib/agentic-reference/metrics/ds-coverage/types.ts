import type ts from 'typescript';

import type { ModuleFile, ModuleGraph } from './module-graph.ts';

/**
 * Where a resolved binding was declared. Carried on identities that came out
 * of a local declaration so that member access (`Card.Header`) can consult the
 * declaring module's `Card.Header = …` assignments even after the declaration
 * itself resolved through a styled or subsetting wrapper into something else.
 */
export interface DeclaredAt {
	declaredAt?: { file: ModuleFile; name: string };
}

/**
 * What an element tag ultimately is, after chasing every import, re-export
 * styled wrapper, and subsetting wrapper to its target:
 *
 * - `host`: an intrinsic element, or a chain ending in one (`styled.div`)
 * - `ds`: a component of a package matching the DS pattern
 * - `external`: a component of any other package
 * - `local`: a component the project defines itself
 * - `unresolved`: statically unresolvable
 */
export type Identity =
	| ({ category: 'host'; tag: string } & DeclaredAt)
	| ({ category: 'ds'; module: string; name: string } & DeclaredAt)
	| ({ category: 'external'; module: string; name: string } & DeclaredAt)
	| ({ category: 'local'; module: string; name: string } & DeclaredAt)
	| ({ category: 'unresolved'; reason: string; circular?: boolean } & DeclaredAt);

/**
 * An intermediate resolution: an identity, or a value that is not itself a
 * renderable e.g. a module namespace (`import * as Forms`) or an object literal
 * of components.
 *
 * Those intermediate resolutions help chain resolutions from imports all the
 * way to element representations in the framework.
 */
export type Resolution =
	| Identity
	| {
			category: 'namespace';
			module: { kind: 'package'; specifier: string } | { kind: 'file'; path: string };
	  }
	| { category: 'object'; file: ModuleFile; node: ts.ObjectLiteralExpression };

/** The identification layer, as seen by a framework implementation. */
export interface IdentityResolver {
	/** Resolve a local name in a file: an import, or a declaration. */
	resolveLocal(file: ModuleFile, name: string): Resolution;
	/** Resolve an export of a graph file, following re-exports and barrels. */
	resolveExport(path: string, exportName: string): Resolution;
	/** Resolve an import of `specifier` from within `file`. */
	resolveModule(file: ModuleFile, specifier: string, exportName: string): Resolution;
	/** Project a member (`Dialog.Root`, `Forms.Input`, `Card.Header`) out of a resolution. */
	memberOf(resolution: Resolution, property: string): Resolution;
	/** Resolve a name bound by a destructuring pattern. */
	resolveDestructured(
		file: ModuleFile,
		declaration: ts.VariableDeclaration,
		path: string[],
		name: string,
	): Resolution;
	/** Analyze a declaration or expression node via the framework, memoized. */
	analyzeDeclaration(file: ModuleFile, node: ts.Node, name: string): Resolution;
}

/**
 * The framework's half of the identification layer: what a local *declaration*
 * ultimately renders. This is where styled wrappers, memo/forwardRef, and
 * subsetting wrappers live — all framework idioms the shared layer cannot know.
 */
export type DeclarationAnalyzer = (
	file: ModuleFile,
	node: ts.Node,
	name: string,
	resolver: IdentityResolver,
) => Resolution;

/** Weighted node totals; conditional branches make these fractional. */
export interface NodeTotals {
	all: number;
	host: number;
	/** ds + external + local + unresolved. */
	component: number;
	ds: number;
	external: number;
	local: number;
	unresolved: number;
}

export interface UnresolvedElement {
	file: string;
	line: number;
	tag: string;
	weight: number;
	reason: string;
}

export interface CensusResult {
	totals: NodeTotals;
	perFile: Map<string, NodeTotals>;
	/** Weighted per-identity counts, keyed `<module>#<name>` (hosts by tag). */
	components: Map<string, { category: 'host' | 'ds' | 'external' | 'local'; count: number }>;
	unresolved: UnresolvedElement[];
}

/** Whether a file's own JSX counts toward the census. */
export type IsCountedFile = (path: string) => boolean;

/** What a framework plugs into the facade. */
export interface FrameworkImplementation {
	createDeclarationAnalyzer(): DeclarationAnalyzer;
	createCensus(): (
		graph: ModuleGraph,
		resolver: IdentityResolver,
		isCounted: IsCountedFile,
	) => CensusResult;
}

export interface DsCoverageOptions {
	/** Root directory of the project to analyze. */
	projectDir: string;
	/** DS package patterns, e.g. `['@ds/*']` or `['@base-ui/react']`. */
	dsPackages: string[];
	/** Framework name (only 'react' is supported for now). */
	framework?: 'react';
	/**
	 * Glob patterns selecting which files' JSX is counted, picomatch syntax.
	 * Matched files are measured. Unmatched files are parsed and still resolve.
	 *
	 * Distinct from the tests/stories/mocks rule in module-graph.ts, which drops
	 * files from the graph as well, and does not parse them at all.
	 */
	censusFilters?: string[];
}

export interface DsCoverageReport {
	framework: string;
	dsPackages: string[];
	censusFilters: string[];
	files: number;
	parseFailures: string[];
	readFailures: string[];
	nodes: NodeTotals;
	/** ds / all, or null when the tree has no JSX at all. */
	dsShareOfAllNodes: number | null;
	/** ds / component-typed, or null when no component-typed elements exist. */
	dsShareOfComponentNodes: number | null;
	/** Per-component attribution, largest count first. */
	components: Record<string, { category: 'host' | 'ds' | 'external' | 'local'; count: number }>;
	/** Every element the analyzer could not classify, so 0 is checkable. */
	unresolvedElements: UnresolvedElement[];
	/** Per-file totals for files containing JSX, for spot validation. */
	perFile: Record<string, NodeTotals>;
}
