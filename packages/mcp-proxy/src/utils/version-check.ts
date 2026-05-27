import { createRequire } from 'node:module';
import * as path from 'node:path';
import { lt } from 'semver';

/**
 * Minimum Storybook version that addon-mcp supports.
 */
export const STORYBOOK_MIN_VERSION = '9.1.16';

function readStorybookVersion(cwd: string): string | null {
	try {
		const requireFromCwd = createRequire(path.join(cwd, 'package.json'));
		const { version } = requireFromCwd('storybook/package.json') as { version: string };
		return version;
	} catch {
		return null;
	}
}

export type StorybookVersionStatus =
	| { status: 'ok' }
	| { status: 'too-old'; version: string }
	| { status: 'not-installed' };

const versionCache = new Map<string, StorybookVersionStatus>();

export function checkStorybookVersion(cwd: string): StorybookVersionStatus {
	const cached = versionCache.get(cwd);
	if (cached) return cached;
	const version = readStorybookVersion(cwd);
	const status: StorybookVersionStatus =
		version === null
			? { status: 'not-installed' }
			: lt(version, STORYBOOK_MIN_VERSION)
				? { status: 'too-old', version }
				: { status: 'ok' };
	versionCache.set(cwd, status);
	return status;
}

/**
 * Drop the cached Storybook version detection. With no argument, clears every
 * entry; with a cwd, only that project's entry. The next `checkStorybookVersion`
 * for a cleared cwd will re-read `storybook/package.json` from disk.
 */
export function clearStorybookVersionCache(cwd?: string): void {
	if (cwd === undefined) {
		versionCache.clear();
		return;
	}
	versionCache.delete(cwd);
}
