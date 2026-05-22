import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

/**
 * Errno codes for which we degrade to "no workspace" rather than throwing.
 * Workspace detection is best-effort metadata for intercept text; a noisy
 * stack trace on every tool call would be worse UX than the missing info.
 */
const SOFT_FS_ERRORS = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']);

function isSoftFsError(error: unknown): boolean {
	return SOFT_FS_ERRORS.has((error as NodeJS.ErrnoException).code ?? '');
}

export type WorkspaceManifest = {
	/** Absolute directory containing the workspace manifest. */
	root: string;
	/** Glob patterns from the manifest. Negation patterns retain their leading `!`. */
	patterns: string[];
	/** Where the patterns came from. Used for error messages and debugging. */
	source: 'pnpm-workspace.yaml' | 'package.json';
};

export type WorkspacePackage = {
	/** Absolute path of the package directory. */
	packagePath: string;
	/** Name from the package's `package.json`, or `undefined` if missing/invalid. */
	name: string | undefined;
	hasStorybook: boolean;
	hasAddonMcp: boolean;
};

/**
 * Look for a workspace manifest at `cwd`. Returns the manifest if `cwd`
 * contains either `pnpm-workspace.yaml` or a `package.json` with a
 * `workspaces` field, otherwise `undefined`.
 */
export async function findWorkspaceManifest(
	cwd: string,
): Promise<WorkspaceManifest | undefined> {
	return readManifestAt(resolve(cwd));
}

async function readManifestAt(dir: string): Promise<WorkspaceManifest | undefined> {
	const pnpmPatterns = await readPnpmWorkspace(join(dir, 'pnpm-workspace.yaml'));
	if (pnpmPatterns) {
		return { root: dir, patterns: pnpmPatterns, source: 'pnpm-workspace.yaml' };
	}
	const pkgPatterns = await readPackageJsonWorkspaces(join(dir, 'package.json'));
	if (pkgPatterns) {
		return { root: dir, patterns: pkgPatterns, source: 'package.json' };
	}
	return undefined;
}

async function readPnpmWorkspace(filePath: string): Promise<string[] | undefined> {
	const raw = await readFileSoft(filePath);
	if (raw === undefined) return undefined;
	const parsed = parseYaml(raw);
	const packages = (parsed as { packages?: unknown }).packages;
	if (!Array.isArray(packages)) return undefined;
	return packages.filter((p): p is string => typeof p === 'string');
}

async function readPackageJsonWorkspaces(filePath: string): Promise<string[] | undefined> {
	const raw = await readFileSoft(filePath);
	if (raw === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	const workspaces = (parsed as { workspaces?: unknown }).workspaces;
	if (Array.isArray(workspaces)) {
		return workspaces.filter((p): p is string => typeof p === 'string');
	}
	// yarn classic form: `{ packages: [...], nohoist: [...] }`
	if (workspaces && typeof workspaces === 'object') {
		const inner = (workspaces as { packages?: unknown }).packages;
		if (Array.isArray(inner)) {
			return inner.filter((p): p is string => typeof p === 'string');
		}
	}
	return undefined;
}

/**
 * Expand workspace glob patterns into a list of package directories and
 * annotate each with Storybook/addon-mcp install status.
 */
export async function enumerateWorkspacePackages(
	manifest: WorkspaceManifest,
): Promise<WorkspacePackage[]> {
	const matched = await glob(manifest.patterns, {
		cwd: manifest.root,
		absolute: true,
		onlyDirectories: true,
		expandDirectories: false,
	});

	const pkgs = await Promise.all(
		matched.sort().map(async (packagePath) => {
			const pkg = await readPackageJsonPartial(join(packagePath, 'package.json'));
			return pkg ? toWorkspacePackage(packagePath, pkg) : undefined;
		}),
	);
	return pkgs.filter((p): p is WorkspacePackage => p !== undefined);
}

type PartialPackageJson = {
	name?: string;
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
};

function toWorkspacePackage(packagePath: string, pkg: PartialPackageJson): WorkspacePackage {
	return {
		packagePath,
		name: pkg.name,
		hasStorybook: hasDep(pkg, 'storybook'),
		hasAddonMcp: hasDep(pkg, '@storybook/addon-mcp'),
	};
}

async function readPackageJsonPartial(filePath: string): Promise<PartialPackageJson | undefined> {
	const raw = await readFileSoft(filePath);
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw) as PartialPackageJson;
	} catch {
		return undefined;
	}
}

function hasDep(pkg: PartialPackageJson, depName: string): boolean {
	return Boolean(pkg.dependencies?.[depName] ?? pkg.devDependencies?.[depName]);
}

async function readFileSoft(filePath: string): Promise<string | undefined> {
	try {
		return await readFile(filePath, 'utf-8');
	} catch (error) {
		if (isSoftFsError(error)) return undefined;
		throw error;
	}
}
