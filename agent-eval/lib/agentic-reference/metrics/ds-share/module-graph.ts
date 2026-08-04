// The project's module graph: which files exist, what each imports and
// exports, and how specifiers resolve between them.
//
// This is the substrate the identification layer walks. It is deliberately
// framework-agnostic — plain ESM/TypeScript module structure — so a future
// non-React implementation reuses it unchanged. Declaration *bodies* are not
// interpreted here; they are handed to the framework analyzer as AST nodes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import ts from 'typescript';

import { hasParseErrors, scriptKindFor } from '../sloc.ts';
import { isExcludedPath, SCRIPT_EXTENSIONS, SKIP_DIRS } from '../../tree/paths.ts';

/** What a local name in a file is bound to. */
export type LocalBinding =
	| { type: 'import'; from: string; name: string }
	| { type: 'namespaceImport'; from: string }
	| { type: 'declaration'; node: ts.Node; name: string };

/** What an exported name of a file resolves to. */
export type ExportBinding =
	| { type: 'local'; name: string }
	| { type: 'reexport'; from: string; name: string }
	| { type: 'namespaceReexport'; from: string }
	| { type: 'expression'; node: ts.Expression };

export interface ModuleFile {
	/** Workspace-relative path with `/` separators. */
	path: string;
	sourceFile: ts.SourceFile;
	locals: Map<string, LocalBinding>;
	exports: Map<string, ExportBinding>;
	/** Specifiers of `export * from` declarations, in source order. */
	starReexports: string[];
	/** Module-scope `X.Y = Z` assignments (compound components), keyed `X.Y`. */
	propertyAssignments: Map<string, ts.Expression>;
}

export type SpecifierResolution =
	| { type: 'file'; path: string }
	| { type: 'package'; specifier: string }
	| { type: 'missing'; specifier: string };

export interface ModuleGraph {
	root: string;
	files: Map<string, ModuleFile>;
	parseFailures: string[];
	resolveSpecifier(fromPath: string, specifier: string): SpecifierResolution;
}

// The census measures the app's UI, so files that never render in the app —
// tests, stories, mocks — are left out entirely (they neither contribute JSX
// nodes nor participate in the module graph).
const NOT_APP_SOURCE =
	/(?:\.(?:test|spec|stories)\.[^/]+$|(?:^|\/)(?:__tests__|__mocks__|\.storybook)\/)/;

function isCensusFile(path: string): boolean {
	return SCRIPT_EXTENSIONS.test(path) && !isExcludedPath(path) && !NOT_APP_SOURCE.test(path);
}

function collectFiles(root: string): string[] {
	const found: string[] = [];
	if (!existsSync(root)) return found;

	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
				continue;
			}
			const path = relative(root, join(current, entry.name)).split(sep).join('/');
			if (isCensusFile(path)) found.push(path);
		}
	};

	walk(root);
	return found.sort();
}

function isTypeOnlyImport(declaration: ts.ImportDeclaration): boolean {
	return declaration.importClause?.isTypeOnly === true;
}

function recordImports(file: ModuleFile, declaration: ts.ImportDeclaration): void {
	const clause = declaration.importClause;
	if (!clause || isTypeOnlyImport(declaration)) return;
	if (!ts.isStringLiteral(declaration.moduleSpecifier)) return;
	const from = declaration.moduleSpecifier.text;

	if (clause.name) {
		file.locals.set(clause.name.text, { type: 'import', from, name: 'default' });
	}
	const bindings = clause.namedBindings;
	if (bindings && ts.isNamespaceImport(bindings)) {
		file.locals.set(bindings.name.text, { type: 'namespaceImport', from });
	}
	if (bindings && ts.isNamedImports(bindings)) {
		for (const specifier of bindings.elements) {
			if (specifier.isTypeOnly) continue;
			file.locals.set(specifier.name.text, {
				type: 'import',
				from,
				name: specifier.propertyName?.text ?? specifier.name.text,
			});
		}
	}
}

function recordExportDeclaration(file: ModuleFile, declaration: ts.ExportDeclaration): void {
	if (declaration.isTypeOnly) return;
	const from =
		declaration.moduleSpecifier && ts.isStringLiteral(declaration.moduleSpecifier)
			? declaration.moduleSpecifier.text
			: null;

	const clause = declaration.exportClause;
	if (!clause) {
		// `export * from './x'`
		if (from !== null) file.starReexports.push(from);
		return;
	}
	if (ts.isNamespaceExport(clause)) {
		// `export * as NS from './x'`
		if (from !== null) file.exports.set(clause.name.text, { type: 'namespaceReexport', from });
		return;
	}
	for (const specifier of clause.elements) {
		if (specifier.isTypeOnly) continue;
		const exported = specifier.name.text;
		const source = specifier.propertyName?.text ?? exported;
		file.exports.set(
			exported,
			from === null ? { type: 'local', name: source } : { type: 'reexport', from, name: source },
		);
	}
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	const modifiers = (node as { modifiers?: readonly ts.Node[] }).modifiers;
	return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function recordDeclaration(file: ModuleFile, node: ts.Node): void {
	if (ts.isVariableStatement(node)) {
		const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
		for (const declaration of node.declarationList.declarations) {
			// Destructuring patterns are not registered: a binding introduced by
			// `const { A } = something` has no statically attributable declaration,
			// so a tag using it will resolve to `unresolved` — which is the truth.
			if (!ts.isIdentifier(declaration.name)) continue;
			const name = declaration.name.text;
			file.locals.set(name, { type: 'declaration', node: declaration, name });
			if (exported) file.exports.set(name, { type: 'local', name });
		}
		return;
	}

	if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
		// An anonymous `export default function () {}` still needs a local slot
		// for the export table to point at; `default` cannot collide, since it is
		// a keyword no real binding can use.
		const name = node.name?.text ?? 'default';
		file.locals.set(name, { type: 'declaration', node, name });
		if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
			file.exports.set('default', { type: 'local', name });
		} else if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
			file.exports.set(name, { type: 'local', name });
		}
		return;
	}

	if (ts.isExportAssignment(node) && !node.isExportEquals) {
		// `export default <expr>`: identifiers follow the local binding so the
		// graph stays framework-agnostic; anything else is analyzed downstream.
		file.exports.set(
			'default',
			ts.isIdentifier(node.expression)
				? { type: 'local', name: node.expression.text }
				: { type: 'expression', node: node.expression },
		);
		return;
	}

	if (
		ts.isExpressionStatement(node) &&
		ts.isBinaryExpression(node.expression) &&
		node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
		ts.isPropertyAccessExpression(node.expression.left) &&
		ts.isIdentifier(node.expression.left.expression) &&
		ts.isIdentifier(node.expression.left.name)
	) {
		// `Card.Header = Header` — the compound-component pattern.
		const key = `${node.expression.left.expression.text}.${node.expression.left.name.text}`;
		file.propertyAssignments.set(key, node.expression.right);
	}
}

function parseModuleFile(root: string, path: string): ModuleFile | 'unparseable' | null {
	let source: string;
	try {
		source = readFileSync(join(root, path), 'utf8');
	} catch {
		return null;
	}
	if (hasParseErrors(path, source)) return 'unparseable';

	const sourceFile = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		scriptKindFor(path),
	);

	const file: ModuleFile = {
		path,
		sourceFile,
		locals: new Map(),
		exports: new Map(),
		starReexports: [],
		propertyAssignments: new Map(),
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) recordImports(file, statement);
		else if (ts.isExportDeclaration(statement)) recordExportDeclaration(file, statement);
		else recordDeclaration(file, statement);
	}

	return file;
}

// Vite's default resolve.extensions order (minus .mts/.cts, which the file
// collector does not gather). When `./b` could be b.ts or b.tsx, this is the
// file the app actually runs.
const EXTENSIONS = ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.cjs'];

/** ESM-style specifiers name the *emitted* file; map them back to sources. */
const EMITTED_TO_SOURCE: Record<string, string[]> = {
	'.js': ['.ts', '.tsx'],
	'.jsx': ['.tsx'],
	'.mjs': ['.mts'],
	'.cjs': ['.cts'],
};

function candidatePaths(resolved: string): string[] {
	const candidates = [resolved, ...EXTENSIONS.map((extension) => resolved + extension)];
	const extension = posix.extname(resolved);
	for (const sourceExtension of EMITTED_TO_SOURCE[extension] ?? []) {
		candidates.push(resolved.slice(0, -extension.length) + sourceExtension);
	}
	for (const indexExtension of EXTENSIONS) {
		candidates.push(posix.join(resolved, `index${indexExtension}`));
	}
	return candidates;
}

interface PathAlias {
	/** The alias pattern split at its single `*` (or [whole] for exact keys). */
	prefix: string;
	suffix: string;
	targets: string[];
}

/**
 * The tree's tsconfig path aliases (`@/*` → `src/*`), read from the root
 * tsconfig.json. `extends` chains are not followed — app trees keep their
 * aliases in the root config. Absent or malformed configs mean no aliases.
 */
function readPathAliases(root: string): { aliases: PathAlias[]; baseUrl: string | null } {
	const configPath = join(root, 'tsconfig.json');
	if (!existsSync(configPath)) return { aliases: [], baseUrl: null };
	const { config } = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path)) as {
		config?: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
	};
	const options = config?.compilerOptions;
	const baseUrl = typeof options?.baseUrl === 'string' ? posix.normalize(options.baseUrl) : null;
	const aliases: PathAlias[] = [];
	for (const [pattern, targets] of Object.entries(options?.paths ?? {})) {
		if (!Array.isArray(targets)) continue;
		const [prefix, suffix, extra] = pattern.split('*');
		if (extra !== undefined) continue; // more than one `*` is not valid tsconfig
		aliases.push({
			prefix: prefix ?? pattern,
			suffix: suffix ?? '',
			targets: targets.filter((target): target is string => typeof target === 'string'),
		});
	}
	return { aliases, baseUrl };
}

/**
 * Whether a bare specifier could name a real npm package. `@/ui`, `~/x`, `#x`
 * and absolute paths are alias conventions, not packages — when their alias is
 * not in the tsconfig, classifying them as an external package would silently
 * absorb local (possibly DS-wrapping) modules into the wrong bucket.
 */
function isPlausiblePackageName(specifier: string): boolean {
	if (specifier.startsWith('/') || specifier.startsWith('#') || specifier.startsWith('~')) {
		return false;
	}
	if (!specifier.startsWith('@')) return specifier.length > 0;
	const [scope, name] = specifier.split('/');
	return (scope?.length ?? 0) > 1 && (name?.length ?? 0) > 0;
}

/** Parse every source file under `root` and index its module structure. */
export function buildModuleGraph(root: string): ModuleGraph {
	const files = new Map<string, ModuleFile>();
	const parseFailures: string[] = [];

	for (const path of collectFiles(root)) {
		const file = parseModuleFile(root, path);
		if (file === null) continue;
		if (file === 'unparseable') {
			parseFailures.push(path);
			continue;
		}
		files.set(path, file);
	}

	const { aliases, baseUrl } = readPathAliases(root);

	const fileAt = (resolved: string): SpecifierResolution | null => {
		for (const candidate of candidatePaths(posix.normalize(resolved))) {
			if (files.has(candidate)) return { type: 'file', path: candidate };
		}
		return null;
	};

	const resolveAliased = (specifier: string): SpecifierResolution | null => {
		for (const alias of aliases) {
			if (!specifier.startsWith(alias.prefix)) continue;
			if (alias.suffix !== '' && !specifier.endsWith(alias.suffix)) continue;
			const captured = specifier.slice(
				alias.prefix.length,
				alias.suffix === '' ? undefined : -alias.suffix.length,
			);
			for (const target of alias.targets) {
				const hit = fileAt(posix.join(baseUrl ?? '.', target.replace('*', captured)));
				if (hit) return hit;
			}
		}
		// A bare baseUrl makes every root-relative path importable (`src/x`).
		if (baseUrl !== null) {
			const hit = fileAt(posix.join(baseUrl, specifier));
			if (hit) return hit;
		}
		return null;
	};

	const resolveSpecifier = (fromPath: string, specifier: string): SpecifierResolution => {
		if (specifier.startsWith('.')) {
			return (
				fileAt(posix.join(posix.dirname(fromPath), specifier)) ?? { type: 'missing', specifier }
			);
		}
		const aliased = resolveAliased(specifier);
		if (aliased) return aliased;
		if (!isPlausiblePackageName(specifier)) return { type: 'missing', specifier };
		return { type: 'package', specifier };
	};

	return { root, files, parseFailures, resolveSpecifier };
}
