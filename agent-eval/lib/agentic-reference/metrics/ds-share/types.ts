// Shared contracts of the ds-share analyzer.
//
// The split mirrors the two layers of the measurement plus the facade:
// - the *identification layer* (identify.ts) resolves names through the module
//   graph and is framework-agnostic;
// - the *census layer* is framework-specific (react/), reached only through
//   `FrameworkImplementation`, so a future Vite-compatible framework slots in
//   beside React without touching the shared layers;
// - the report is what analyzeDsShare hands back.
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
 * What a JSX tag ultimately is, after chasing every import, re-export, styled
 * wrapper, and subsetting wrapper to its target:
 *
 * - `host`: an intrinsic element, or a chain ending in one (`styled.div`)
 * - `ds`: a component of a package matching the DS pattern
 * - `external`: a component of any other package
 * - `local`: a component the project defines itself
 * - `unresolved`: statically unresolvable — reported explicitly, never guessed
 *   (`circular` marks the placeholder handed to a resolution that re-entered
 *   itself; it must never be cached as a final answer)
 */
export type Identity =
	| ({ category: 'host'; tag: string } & DeclaredAt)
	| ({ category: 'ds'; module: string; name: string } & DeclaredAt)
	| ({ category: 'external'; module: string; name: string } & DeclaredAt)
	| ({ category: 'local'; module: string; name: string } & DeclaredAt)
	| ({ category: 'unresolved'; reason: string; circular?: boolean } & DeclaredAt);

/**
 * An intermediate resolution: an identity, or a value that is not itself a
 * renderable — a module namespace (`import * as Forms`) or an object literal
 * of components — which a member access can still project an identity out of.
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

/** What a framework plugs into the facade. */
export interface FrameworkImplementation {
	createDeclarationAnalyzer(): DeclarationAnalyzer;
	census(graph: ModuleGraph, resolver: IdentityResolver): CensusResult;
}

export interface DsShareOptions {
	/** DS package patterns, e.g. `['@ds/*']` or `['@base-ui/react', '@droppy/*']`. */
	dsPackages: string[];
	/** Only `react` exists today. */
	framework?: 'react';
}

export interface DsShareReport {
	framework: string;
	dsPackages: string[];
	/** Files the census walked. */
	files: number;
	parseFailures: string[];
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
