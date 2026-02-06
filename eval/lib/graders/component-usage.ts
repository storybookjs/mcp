import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TaskConfig, GradingSummary } from '../../types.ts';

/**
 * Information about imports extracted from source code.
 * Used by both component usage scoring and source visualization.
 */
export type ImportInfo = {
	source: string;
	specifiers: string[];
};

/**
 * Packages to ignore when calculating component usage score.
 * Includes React and React-DOM and any subpaths.
 */
const IGNORED_PACKAGES = ['react', 'react-dom'];

function isIgnoredPackage(source: string): boolean {
	for (const pkg of IGNORED_PACKAGES) {
		if (source === pkg || source.startsWith(`${pkg}/`)) {
			return true;
		}
	}
	return false;
}

/**
 * Extract all external (non-relative) imports from file content.
 *
 * @param content - The source code content to parse
 * @param options - Optional configuration
 * @param options.ignorePackages - If true, skip IGNORED_PACKAGES (react, react-dom). Default: true
 * @param options.defaultImportName - How to represent default imports in specifiers:
 *   - 'keyword': Use the string "default" (for config matching). This is the default.
 *   - 'identifier': Use the actual identifier name (for display purposes)
 * @returns Array of ImportInfo with source package and specifier names
 */
export function extractImportsFromContent(
	content: string,
	options: {
		ignorePackages?: boolean;
		defaultImportName?: 'keyword' | 'identifier';
	} = {},
): ImportInfo[] {
	const { ignorePackages = true, defaultImportName = 'keyword' } = options;
	const imports: ImportInfo[] = [];

	// Regex to match complete import statements (including multi-line)
	const importRegex = /import\s+[\s\S]*?from\s+['"]([^'"]+)['"];?/g;

	let match;
	while ((match = importRegex.exec(content)) !== null) {
		const fullStatement = match[0];
		const source = match[1];

		// Skip relative imports
		if (!source || source.startsWith('.') || source.startsWith('/')) continue;

		// Skip ignored packages (react, react-dom, and subpaths)
		if (ignorePackages && isIgnoredPackage(source)) continue;

		// Extract specifiers
		const specifiers: string[] = [];

		// Normalize the statement (collapse whitespace for easier parsing)
		const normalized = fullStatement.replace(/\s+/g, ' ');

		// Default import: import Foo from 'lib' (but NOT import { Foo } from 'lib')
		// Match: import <identifier> from (without { before from)
		const defaultMatch = normalized.match(/^import\s+(\w+)\s+from/);
		if (defaultMatch?.[1]) {
			// This is a default import
			specifiers.push(defaultImportName === 'keyword' ? 'default' : defaultMatch[1]);
		}

		// Default + named: import Foo, { Bar } from 'lib'
		const defaultNamedMatch = normalized.match(/^import\s+(\w+)\s*,\s*\{/);
		if (defaultNamedMatch?.[1]) {
			// Has both default and named - default is already added above if defaultMatch matched
			// If defaultMatch didn't match but this does, add default
			if (!defaultMatch) {
				specifiers.push(defaultImportName === 'keyword' ? 'default' : defaultNamedMatch[1]);
			}
		}

		// Named imports: import { Foo, Bar } from 'lib'
		const namedMatch = fullStatement.match(/\{([^}]+)\}/);
		if (namedMatch?.[1]) {
			const names = namedMatch[1].split(',').map((s) => {
				// Handle 'Foo as Bar' -> take the original name (what was imported)
				const parts = s.trim().split(/\s+as\s+/);
				return parts[0]?.trim() ?? '';
			});
			specifiers.push(...names.filter((n) => n.length > 0));
		}

		// Namespace import: import * as Foo from 'lib'
		const namespaceMatch = normalized.match(/\*\s+as\s+(\w+)/);
		if (namespaceMatch?.[1]) {
			specifiers.push(`* as ${namespaceMatch[1]}`);
		}

		if (specifiers.length > 0) {
			imports.push({ source, specifiers });
		}
	}

	return imports;
}

/**
 * Recursively find all TypeScript/TSX files in a directory.
 */
async function findTsFiles(dir: string): Promise<string[]> {
	const files: string[] = [];

	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				// Skip node_modules
				if (entry.name === 'node_modules') continue;
				files.push(...(await findTsFiles(fullPath)));
			} else if (entry.isFile()) {
				if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
					files.push(fullPath);
				}
			}
		}
	} catch {
		// Directory doesn't exist or can't be read
	}

	return files;
}

/**
 * Load task config from config.json in the task directory.
 */
async function loadTaskConfig(taskPath: string): Promise<TaskConfig | null> {
	const configPath = path.join(taskPath, 'config.json');

	try {
		const config = await import(configPath, { with: { type: 'json' } });
		return config.default as TaskConfig;
	} catch {
		// config.json doesn't exist or is invalid
		return null;
	}
}

export type ComponentUsageResult = NonNullable<GradingSummary['componentUsage']>;

/**
 * Compute the component usage score by comparing actual imports against expected imports.
 *
 * Scoring:
 * - +1 for each expected import that was used
 * - -1 for each expected import that was NOT used
 * - -1 for each unexpected external import (not in expected list)
 *
 * Use "default" as a specifier name to expect a default import.
 * React and react-dom imports are ignored.
 */
export async function computeComponentUsageScore(
	projectPath: string,
	taskPath: string,
): Promise<ComponentUsageResult | undefined> {
	const config = await loadTaskConfig(taskPath);

	// If no config or no expectedImports, skip this check
	if (!config?.expectedImports) {
		return undefined;
	}

	const expectedImports = config.expectedImports;

	// Build a set of expected "source:specifier" pairs for easy lookup
	const expectedSet = new Set<string>();
	for (const [source, specifiers] of Object.entries(expectedImports)) {
		for (const specifier of specifiers) {
			expectedSet.add(`${source}:${specifier}`);
		}
	}

	// Get expected package names for checking extra imports
	const expectedPackages = new Set(Object.keys(expectedImports));

	// Find all TS/TSX files in src/
	const srcPath = path.join(projectPath, 'src');
	const files = await findTsFiles(srcPath);

	// Collect all actual imports
	const actualImports: ImportInfo[] = [];
	for (const file of files) {
		try {
			const content = await fs.readFile(file, 'utf-8');
			actualImports.push(...extractImportsFromContent(content));
		} catch {
			// File can't be read
		}
	}

	// Build set of actual "source:specifier" pairs
	const actualSet = new Set<string>();
	const actualPackageSpecifiers = new Map<string, Set<string>>();

	for (const imp of actualImports) {
		if (!actualPackageSpecifiers.has(imp.source)) {
			actualPackageSpecifiers.set(imp.source, new Set());
		}
		const specSet = actualPackageSpecifiers.get(imp.source)!;

		for (const specifier of imp.specifiers) {
			actualSet.add(`${imp.source}:${specifier}`);
			specSet.add(specifier);
		}
	}

	// Calculate score
	let matched = 0;
	let missing = 0;
	let unexpected = 0;

	// Check expected imports
	for (const key of expectedSet) {
		if (actualSet.has(key)) {
			matched++;
		} else {
			missing++;
		}
	}

	// Check for unexpected imports (from packages not in expected list)
	for (const [source, specifiers] of actualPackageSpecifiers) {
		if (!expectedPackages.has(source)) {
			// All specifiers from this package are unexpected
			unexpected += specifiers.size;
		} else {
			// Check for unexpected specifiers from expected packages
			const expectedSpecifiers = new Set(expectedImports[source] ?? []);
			for (const specifier of specifiers) {
				if (!expectedSpecifiers.has(specifier)) {
					unexpected++;
				}
			}
		}
	}

	const score = matched - missing - unexpected;

	return { score, matched, missing, unexpected };
}
