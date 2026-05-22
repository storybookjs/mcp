import { isAbsolute, join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { enumerateWorkspacePackages, findWorkspaceManifest } from './workspace.ts';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__', 'workspace');

describe('findWorkspaceManifest', () => {
	it('detects a pnpm-workspace.yaml at the cwd', async () => {
		const manifest = await findWorkspaceManifest(join(FIXTURES, 'pnpm-monorepo'));
		expect(manifest?.source).toBe('pnpm-workspace.yaml');
		expect(manifest?.root).toBe(join(FIXTURES, 'pnpm-monorepo'));
		expect(manifest?.patterns).toEqual([
			'packages/*',
			'apps/*',
			'excluded/*',
			'!excluded/skip-me',
		]);
	});

	it('returns undefined for a nested cwd inside a monorepo (no upward walk)', async () => {
		const manifest = await findWorkspaceManifest(
			join(FIXTURES, 'pnpm-monorepo', 'packages', 'has-sb'),
		);
		expect(manifest).toBeUndefined();
	});

	it('detects npm workspaces (array form)', async () => {
		const manifest = await findWorkspaceManifest(join(FIXTURES, 'npm-monorepo'));
		expect(manifest?.source).toBe('package.json');
		expect(manifest?.patterns).toEqual(['packages/*']);
	});

	it('detects yarn classic workspaces (object form)', async () => {
		const manifest = await findWorkspaceManifest(join(FIXTURES, 'yarn-classic'));
		expect(manifest?.source).toBe('package.json');
		expect(manifest?.patterns).toEqual(['packages/*']);
	});

	it('returns undefined for a single-package directory with no workspace manifest', async () => {
		const manifest = await findWorkspaceManifest(join(FIXTURES, 'single-package'));
		expect(manifest).toBeUndefined();
	});
});

describe('enumerateWorkspacePackages', () => {
	it('expands glob patterns and annotates Storybook + addon-mcp install state', async () => {
		const root = join(FIXTURES, 'pnpm-monorepo');
		const manifest = await findWorkspaceManifest(root);
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
		const manifest = await findWorkspaceManifest(root);
		const packages = await enumerateWorkspacePackages(manifest!);
		for (const pkg of packages) {
			expect(isAbsolute(pkg.packagePath)).toBe(true);
			expect(pkg.packagePath.startsWith(root)).toBe(true);
		}
	});

	it('skips workspace candidate dirs that lack a package.json', async () => {
		// `apps/*` matches `apps/web` (has package.json) but no other dir under apps/.
		const root = join(FIXTURES, 'pnpm-monorepo');
		const manifest = await findWorkspaceManifest(root);
		const packages = await enumerateWorkspacePackages(manifest!);
		expect(packages.filter((p) => p.packagePath.includes(`${sep}apps${sep}`))).toHaveLength(
			1,
		);
	});
});
