import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { lt } from 'semver';

/**
 * Minimum Storybook version that addon-mcp supports (user-facing).
 */
export const STORYBOOK_MIN_VERSION = '10.5.0';

/**
 * Comparison floor for the minimum version. The `-0` prerelease suffix is the
 * lowest possible 10.5.0 build, so every 10.5.0 prerelease (alpha/beta/rc) is
 * accepted alongside the stable release, while anything below 10.5.0 is rejected.
 */
const STORYBOOK_MIN_VERSION_FLOOR = '10.5.0-0';

function readStorybookVersion(cwd: string): string | void {
	try {
		const require = createRequire(path.join(cwd, 'package.json'));
		const pkgPath = require.resolve('storybook/package.json');
		return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
	} catch {
		// Storybook is not installed / not resolvable from this cwd.
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
		version === undefined
			? { status: 'not-installed' }
			: lt(version, STORYBOOK_MIN_VERSION_FLOOR)
				? { status: 'too-old', version }
				: { status: 'ok' };

	if (status.status === 'ok') versionCache.set(cwd, status);
	return status;
}

export function clearStorybookVersionCache(cwd?: string): void {
	if (cwd === undefined) {
		versionCache.clear();
		return;
	}
	versionCache.delete(cwd);
}
