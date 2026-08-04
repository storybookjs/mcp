// The identification layer: resolve a name to what it ultimately is.
//
// Marker-free by construction — nothing here reads annotations in the product
// or the DS. A name's identity comes solely from where the module graph says it
// came from: imports from a DS-pattern package are DS, re-exports and barrel
// files (including `export *` chains) are followed recursively until a
// terminal binding is found, and local declarations are handed to the
// framework's declaration analyzer (which recurses back in here for any names
// *it* needs — `styled(X)` resolving X, a wrapper resolving its root tag).
//
// Every entry point is memoized and cycle-guarded. A resolution that re-enters
// itself gets a `circular` placeholder rather than looping — and any result
// computed while such a placeholder was observed is NOT cached, because it is
// only valid for the cycle that produced it; caching it would serve the
// placeholder to non-cyclic callers forever.
import ts from 'typescript';

import type { ModuleFile, ModuleGraph } from './module-graph.ts';
import type { DeclarationAnalyzer, IdentityResolver, Resolution } from './types.ts';

function unresolved(reason: string): Resolution {
	return { category: 'unresolved', reason };
}

export function createResolver(
	graph: ModuleGraph,
	isDsPackage: (specifier: string) => boolean,
	analyzeDeclaration: DeclarationAnalyzer,
): IdentityResolver {
	const cache = new Map<string, Resolution>();
	const inFlight = new Set<string>();
	const declarationCache = new Map<ts.Node, Resolution>();
	const declarationsInFlight = new Set<ts.Node>();
	// Bumped every time a circular placeholder is handed out; a computation
	// that observed one produced a cycle-relative answer, not a cacheable one.
	let circularPlaceholders = 0;

	function circularPlaceholder(reason: string): Resolution {
		circularPlaceholders += 1;
		return { category: 'unresolved', reason, circular: true };
	}

	/** Memoize + cycle-guard a resolution under `key`. */
	function guarded(key: string, resolve: () => Resolution): Resolution {
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		if (inFlight.has(key)) return circularPlaceholder(`circular resolution at ${key}`);
		inFlight.add(key);
		const placeholdersBefore = circularPlaceholders;
		try {
			const resolution = resolve();
			if (circularPlaceholders === placeholdersBefore) cache.set(key, resolution);
			return resolution;
		} finally {
			inFlight.delete(key);
		}
	}

	function packageIdentity(specifier: string, exportName: string): Resolution {
		return isDsPackage(specifier)
			? { category: 'ds', module: specifier, name: exportName }
			: { category: 'external', module: specifier, name: exportName };
	}

	/**
	 * Whether `path` (a graph file) provides `exportName`, looking through its
	 * own `export *` chains. Star re-exports never provide `default` (ESM
	 * semantics), and a file whose very export is mid-resolution is no provider
	 * — reaching the name through it would only re-enter the cycle. Used to
	 * pick which star re-export to follow in a barrel.
	 */
	function providesExport(path: string, exportName: string, seen: Set<string>): boolean {
		if (exportName === 'default') return false;
		if (seen.has(path)) return false;
		if (inFlight.has(`export:${path}#${exportName}`)) return false;
		seen.add(path);
		const file = graph.files.get(path);
		if (!file) return false;
		if (file.exports.has(exportName)) return true;
		return file.starReexports.some((specifier) => {
			const target = graph.resolveSpecifier(path, specifier);
			return target.type === 'file' && providesExport(target.path, exportName, seen);
		});
	}

	/** Every package reached by the star chain, in source order, deduplicated. */
	function starPackages(file: ModuleFile, seen: Set<string>, found: string[]): string[] {
		if (seen.has(file.path)) return found;
		seen.add(file.path);
		for (const specifier of file.starReexports) {
			const target = graph.resolveSpecifier(file.path, specifier);
			if (target.type === 'package' && !found.includes(target.specifier)) {
				found.push(target.specifier);
			}
			if (target.type === 'file') {
				const next = graph.files.get(target.path);
				if (next) starPackages(next, seen, found);
			}
		}
		return found;
	}

	/**
	 * `export * from '<package>'` anywhere in the star chain: the package's
	 * export list is unknowable statically. One candidate package is a safe
	 * assumption; several that agree on DS-ness still classify correctly (the
	 * attribution key approximates to the first); several that disagree would
	 * turn the share into a guess, so they are reported unresolved instead.
	 */
	function starPackageFallback(file: ModuleFile, exportName: string): Resolution | null {
		const candidates = starPackages(file, new Set(), []);
		if (candidates.length === 0) return null;
		const first = candidates[0] as string;
		if (candidates.every((candidate) => isDsPackage(candidate) === isDsPackage(first))) {
			return packageIdentity(first, exportName);
		}
		return unresolved(
			`'${exportName}' is star re-exported from several packages (${candidates.join(', ')}) that disagree on DS membership`,
		);
	}

	function resolveStarReexports(file: ModuleFile, exportName: string): Resolution | null {
		if (exportName === 'default') return null;
		let circularResult: Resolution | null = null;
		for (const specifier of file.starReexports) {
			const target = graph.resolveSpecifier(file.path, specifier);
			// Seeding `seen` with this barrel keeps a cycle from vouching for a
			// name it can only reach back through us.
			if (target.type !== 'file') continue;
			if (!providesExport(target.path, exportName, new Set([file.path]))) continue;
			const resolution = resolveExport(target.path, exportName);
			// A circular answer from one star does not disqualify the next one.
			if (resolution.category === 'unresolved' && resolution.circular) {
				circularResult = resolution;
				continue;
			}
			return resolution;
		}
		return starPackageFallback(file, exportName) ?? circularResult;
	}

	function resolveModule(file: ModuleFile, specifier: string, exportName: string): Resolution {
		const target = graph.resolveSpecifier(file.path, specifier);
		if (target.type === 'package') return packageIdentity(target.specifier, exportName);
		if (target.type === 'missing') return unresolved(`unresolvable import '${specifier}'`);
		return resolveExport(target.path, exportName);
	}

	function resolveExport(path: string, exportName: string): Resolution {
		return guarded(`export:${path}#${exportName}`, () => {
			const file = graph.files.get(path);
			if (!file) return unresolved(`no module at ${path}`);

			const binding = file.exports.get(exportName);
			if (binding === undefined) {
				return (
					resolveStarReexports(file, exportName) ??
					unresolved(`${path} has no export '${exportName}'`)
				);
			}

			switch (binding.type) {
				case 'local':
					return resolveLocal(file, binding.name);
				case 'reexport':
					return resolveModule(file, binding.from, binding.name);
				case 'namespaceReexport': {
					const target = graph.resolveSpecifier(path, binding.from);
					if (target.type === 'package') {
						return {
							category: 'namespace',
							module: { kind: 'package', specifier: target.specifier },
						};
					}
					if (target.type === 'file') {
						return { category: 'namespace', module: { kind: 'file', path: target.path } };
					}
					return unresolved(`unresolvable import '${binding.from}'`);
				}
				case 'expression':
					return memoizedAnalyze(file, binding.node, exportName);
			}
		});
	}

	function resolveLocal(file: ModuleFile, name: string): Resolution {
		return guarded(`local:${file.path}//${name}`, () => {
			const binding = file.locals.get(name);
			if (binding === undefined) return unresolved(`unbound identifier '${name}' in ${file.path}`);

			switch (binding.type) {
				case 'import':
					return resolveModule(file, binding.from, binding.name);
				case 'namespaceImport': {
					const target = graph.resolveSpecifier(file.path, binding.from);
					if (target.type === 'package') {
						return {
							category: 'namespace',
							module: { kind: 'package', specifier: target.specifier },
						};
					}
					if (target.type === 'file') {
						return { category: 'namespace', module: { kind: 'file', path: target.path } };
					}
					return unresolved(`unresolvable import '${binding.from}'`);
				}
				case 'declaration': {
					const resolution = memoizedAnalyze(file, binding.node, name);
					// The breadcrumb lets member access find `Name.Prop = …`
					// assignments in this module even when the declaration itself
					// resolved through a wrapper into a DS or host identity.
					if (resolution.category === 'namespace' || resolution.category === 'object') {
						return resolution;
					}
					return { ...resolution, declaredAt: { file, name } };
				}
			}
		});
	}

	function memoizedAnalyze(file: ModuleFile, node: ts.Node, name: string): Resolution {
		const cached = declarationCache.get(node);
		if (cached !== undefined) return cached;
		if (declarationsInFlight.has(node)) {
			return circularPlaceholder(`circular declaration for '${name}' in ${file.path}`);
		}
		declarationsInFlight.add(node);
		const placeholdersBefore = circularPlaceholders;
		try {
			const resolution = analyzeDeclaration(file, node, name, resolver);
			if (circularPlaceholders === placeholdersBefore) declarationCache.set(node, resolution);
			return resolution;
		} finally {
			declarationsInFlight.delete(node);
		}
	}

	function memberOf(resolution: Resolution, property: string): Resolution {
		// The compound-component pattern first: `Card.Header = Header` beside the
		// declaration wins over whatever Card itself resolved into — otherwise a
		// wrapper's DS identity would swallow its locally attached members and
		// fabricate DS names that do not exist.
		if (resolution.category !== 'namespace' && resolution.category !== 'object') {
			const site = resolution.declaredAt;
			const assigned = site?.file.propertyAssignments.get(`${site.name}.${property}`);
			if (site && assigned) return memoizedAnalyze(site.file, assigned, property);
		}

		switch (resolution.category) {
			case 'namespace':
				return resolution.module.kind === 'package'
					? packageIdentity(resolution.module.specifier, property)
					: resolveExport(resolution.module.path, property);
			case 'ds':
			case 'external': {
				// A member of a default import is a member of the module itself
				// (`React.memo`, `Lottie.Player`), not of a component named `default`.
				const name = resolution.name === 'default' ? property : `${resolution.name}.${property}`;
				return { category: resolution.category, module: resolution.module, name };
			}
			case 'object': {
				for (const objectProperty of resolution.node.properties) {
					if (
						ts.isPropertyAssignment(objectProperty) &&
						(ts.isIdentifier(objectProperty.name) || ts.isStringLiteral(objectProperty.name)) &&
						objectProperty.name.text === property
					) {
						return memoizedAnalyze(resolution.file, objectProperty.initializer, property);
					}
					if (
						ts.isShorthandPropertyAssignment(objectProperty) &&
						objectProperty.name.text === property
					) {
						return resolveLocal(resolution.file, property);
					}
				}
				return unresolved(`no property '${property}' on object in ${resolution.file.path}`);
			}
			case 'local': {
				const file = graph.files.get(resolution.module);
				const assigned = file?.propertyAssignments.get(`${resolution.name}.${property}`);
				if (file && assigned) return memoizedAnalyze(file, assigned, property);
				return unresolved(`unresolved member '${resolution.name}.${property}'`);
			}
			case 'host':
				return unresolved(`member access on intrinsic '${resolution.tag}'`);
			case 'unresolved':
				return resolution;
		}
	}

	const resolver: IdentityResolver = {
		resolveLocal,
		resolveExport,
		resolveModule,
		memberOf,
		analyzeDeclaration: memoizedAnalyze,
	};
	return resolver;
}
