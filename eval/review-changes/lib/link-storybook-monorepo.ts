/**
 * Symlink Storybook packages from the Storybook monorepo into a target
 * repo's node_modules — the "dogfood-against-local-storybook" pattern.
 *
 * Why: the recorder's precise data path (`get-changed-stories` via MCP)
 * requires Storybook 10.4+ change-detection. Older targets (mealdrop @
 * 10.2, chromatic @ 10.3.4) lack that feature. Rather than upgrading
 * their dependencies (invasive, churn on lockfiles), we redirect the
 * installed Storybook packages at the OSS monorepo's built `dist/`.
 *
 * Strategy mirrors `packages/addon-mcp/LOCAL_STORYBOOK_DEV.md`:
 *   - Keep the installed package physically in the target's
 *     `node_modules/<name>` so peer-dep resolution stays correct.
 *   - Swap its `dist/` (or its whole content, when there is no separate
 *     dist) for a symlink to `<storybook>/code/<sub-path>`.
 *   - Don't symlink the package's `package.json`; it provides the
 *     exports map that points into `dist/`.
 *
 * For Storybook packages where the published shape differs from the
 * monorepo layout, we mirror the whole package directory contents via
 * per-file symlinks — preserving the installed `package.json` but
 * swapping every other top-level entry.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Mapping from package name → directory under `<storybookRepo>/code/`
 * that contains the built package. The directory must contain a
 * `package.json` and a built `dist/` (or other publishable files).
 */
export const STORYBOOK_PACKAGE_MAP: Record<string, string> = {
	storybook: 'core',
	'@storybook/react': 'renderers/react',
	'@storybook/react-vite': 'frameworks/react-vite',
	'@storybook/react-dom-shim': 'lib/react-dom-shim',
	'@storybook/csf-plugin': 'lib/csf-plugin',
	'@storybook/builder-vite': 'builders/builder-vite',
	'@storybook/addon-a11y': 'addons/a11y',
	'@storybook/addon-docs': 'addons/docs',
	'@storybook/addon-vitest': 'addons/vitest',
	'@storybook/addon-themes': 'addons/themes',
	'@storybook/addon-review-changes': 'addons/review-changes',
	// Note: addon-coverage / addon-designs / test-runner are not in the
	// OSS monorepo — leave the installed ones in place.
};

export interface LinkOptions {
	targetRepo: string;
	storybookRepo: string;
	/** Override the package map. Useful for tests / specific scenarios. */
	packages?: Record<string, string>;
	/** When true, skip packages whose dist/ has not been built. */
	skipMissingDist?: boolean;
}

export interface LinkResult {
	linked: string[];
	skipped: { pkg: string; reason: string }[];
}

async function isDirectory(p: string): Promise<boolean> {
	try {
		const s = await fs.stat(p);
		return s.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Replace `targetDir/<entry>` with a symlink to `srcDir/<entry>` for
 * every top-level entry except `package.json` (we preserve the installed
 * one so its exports map keeps pointing at relative paths).
 */
async function mirrorPackage(srcDir: string, targetDir: string): Promise<void> {
	const entries = await fs.readdir(srcDir);
	for (const entry of entries) {
		if (entry === 'package.json') continue;
		const src = path.join(srcDir, entry);
		const dst = path.join(targetDir, entry);
		try {
			await fs.rm(dst, { recursive: true, force: true });
		} catch {}
		const stat = await fs.stat(src);
		await fs.symlink(src, dst, stat.isDirectory() ? 'dir' : 'file');
	}
}

export async function linkStorybookMonorepo(
	options: LinkOptions,
): Promise<LinkResult> {
	const packages = options.packages ?? STORYBOOK_PACKAGE_MAP;
	const result: LinkResult = { linked: [], skipped: [] };

	for (const [pkgName, subPath] of Object.entries(packages)) {
		const srcDir = path.join(options.storybookRepo, 'code', subPath);
		const targetDir = path.join(options.targetRepo, 'node_modules', pkgName);

		if (!(await isDirectory(srcDir))) {
			result.skipped.push({ pkg: pkgName, reason: `src not found: ${srcDir}` });
			continue;
		}
		if (!(await isDirectory(targetDir))) {
			// Not installed in the target; skip rather than fabricate it.
			result.skipped.push({
				pkg: pkgName,
				reason: 'not present in target node_modules; skipping (install it first)',
			});
			continue;
		}

		// Sanity: did the monorepo actually build this package?
		const srcDist = path.join(srcDir, 'dist');
		if (options.skipMissingDist && !(await isDirectory(srcDist))) {
			result.skipped.push({ pkg: pkgName, reason: 'src dist/ missing — run `yarn build`' });
			continue;
		}

		await mirrorPackage(srcDir, targetDir);
		result.linked.push(pkgName);
	}

	return result;
}
