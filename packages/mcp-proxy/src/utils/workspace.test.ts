import { isAbsolute, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { enumerateWorkspacePackages, findWorkspaceRoot } from './workspace.ts';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__', 'workspace');

describe('findWorkspaceRoot', () => {
	it('detects a pnpm-workspace.yaml at the cwd', async () => {
		const manifest = await findWorkspaceRoot(join(FIXTURES, 'pnpm-monorepo'));
		expect(manifest?.source).toBe('pnpm-workspace.yaml');
		expect(manifest?.root).toBe(join(FIXTURES, 'pnpm-monorepo'));
		expect(manifest?.patterns).toEqual([
			'packages/*',
			'apps/*',
			'excluded/*',
			'!excluded/skip-me',
		]);
	});

	it('walks upward to find a workspace root from a nested cwd', async () => {
		const manifest = await findWorkspaceRoot(
			join(FIXTURES, 'pnpm-monorepo', 'packages', 'has-sb'),
		);
		expect(manifest?.root).toBe(join(FIXTURES, 'pnpm-monorepo'));
	});

	it('detects npm workspaces (array form)', async () => {
		const manifest = await findWorkspaceRoot(join(FIXTURES, 'npm-monorepo'));
		expect(manifest?.source).toBe('package.json');
		expect(manifest?.patterns).toEqual(['packages/*']);
	});

	it('detects yarn classic workspaces (object form)', async () => {
		const manifest = await findWorkspaceRoot(join(FIXTURES, 'yarn-classic'));
		expect(manifest?.source).toBe('package.json');
		expect(manifest?.patterns).toEqual(['packages/*']);
	});

	it('does not treat a leaf package directory as its own workspace root', async () => {
		// The single-package fixture itself has no manifest; the helper may still
		// resolve to an ancestor workspace root (e.g. the repo's own root) when
		// invoked inside a monorepo. We only assert that the leaf itself is not
		// reported as the root.
		const leaf = join(FIXTURES, 'single-package');
		const manifest = await findWorkspaceRoot(leaf);
		expect(manifest?.root).not.toBe(leaf);
	});
});

describe('enumerateWorkspacePackages', () => {
	it('expands glob patterns and annotates Storybook + addon-mcp install state', async () => {
		const root = join(FIXTURES, 'pnpm-monorepo');
		const manifest = await findWorkspaceRoot(root);
		const packages = await enumerateWorkspacePackages(manifest!);

		const byName = Object.fromEntries(packages.map((p) => [p.name, p]));

		expect(Object.keys(byName).sort()).toEqual([
			'@fixture/has-addon',
			'@fixture/has-sb',
			'@fixture/no-sb',
			'@fixture/web-app',
		]);

		expect(byName['@fixture/has-sb']).toMatchObject({ hasStorybook: true, hasAddonMcp: false });
		expect(byName['@fixture/has-addon']).toMatchObject({
			hasStorybook: true,
			hasAddonMcp: true,
		});
		expect(byName['@fixture/no-sb']).toMatchObject({ hasStorybook: false, hasAddonMcp: false });
		expect(byName['@fixture/web-app']).toMatchObject({ hasStorybook: true, hasAddonMcp: false });

		// '!excluded/skip-me' negation filters that package out of the result.
		expect(byName['@fixture/skip-me']).toBeUndefined();
	});

	it('returns absolute paths under the workspace root', async () => {
		const root = join(FIXTURES, 'pnpm-monorepo');
		const manifest = await findWorkspaceRoot(root);
		const packages = await enumerateWorkspacePackages(manifest!);
		for (const pkg of packages) {
			expect(isAbsolute(pkg.packagePath)).toBe(true);
			expect(pkg.packagePath.startsWith(root)).toBe(true);
		}
	});

	it('skips workspace candidate dirs that lack a package.json', async () => {
		// `apps/*` matches `apps/web` (has package.json) but no other dir under apps/.
		const root = join(FIXTURES, 'pnpm-monorepo');
		const manifest = await findWorkspaceRoot(root);
		const packages = await enumerateWorkspacePackages(manifest!);
		expect(packages.filter((p) => p.packagePath.includes(`${sep}apps${sep}`))).toHaveLength(
			1,
		);
	});
});
