import { createRequire } from 'node:module';
import * as path from 'node:path';
import { lt } from 'semver';

/**
 * Minimum Storybook version that writes a registry entry the proxy can resolve.
 * Anything older won't appear in the registry and can't be reached via the proxy.
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

export function checkStorybookVersion(cwd: string): StorybookVersionStatus {
	const version = readStorybookVersion(cwd);
	if (!version) return { status: 'not-installed' };
	if (lt(version, STORYBOOK_MIN_VERSION)) return { status: 'too-old', version };
	return { status: 'ok' };
}
