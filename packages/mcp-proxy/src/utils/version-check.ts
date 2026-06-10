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

export type StorybookVersionStatus =
	| { status: 'ok' }
	| { status: 'too-old'; version: string }
	| { status: 'not-installed' };

export function classifyStorybookVersion(version: string | undefined): StorybookVersionStatus {
	if (version === undefined) return { status: 'not-installed' };
	// Storybook canary releases are published as `0.0.0-*`; semver considers these < any
	// stable version, but we still want to treat them as supported.
	if (version.startsWith('0.0.0-')) return { status: 'ok' };
	return lt(version, STORYBOOK_MIN_VERSION_FLOOR)
		? { status: 'too-old', version }
		: { status: 'ok' };
}

const versionCache = new Map<string, StorybookVersionStatus>();

export function checkStorybookVersion(cwd: string): StorybookVersionStatus {
	const cached = versionCache.get(cwd);
	if (cached) return cached;
	const status = classifyStorybookVersion(readStorybookVersion(cwd));
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

function readStorybookVersion(cwd: string): string | undefined {
	const require = createRequire(path.join(cwd, 'package.json'));
	// require.resolve.paths is the only way to get actual path
	// without nodeJS resolution cache
	const searchPaths = require.resolve.paths('storybook') ?? [];
	for (const base of searchPaths) {
		try {
			const raw = readFileSync(path.join(base, 'storybook', 'package.json'), 'utf8');
			const { version } = JSON.parse(raw) as { version?: unknown };
			return typeof version === 'string' ? version : undefined;
		} catch {
			// parse error or file not found.
		}
	}
	return undefined;
}
