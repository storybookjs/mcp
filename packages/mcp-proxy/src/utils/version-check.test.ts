import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	checkStorybookVersion,
	clearStorybookVersionCache,
	STORYBOOK_MIN_VERSION,
} from './version-check.ts';

vi.mock('node:module', () => ({
	createRequire: vi.fn(),
}));

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
}));

/**
 * Mutable map of cwd -> installed Storybook version (null = not installed).
 *
 * The implementation anchors resolution at `<cwd>/package.json` via
 * `createRequire`, resolves `storybook/package.json` from there, then reads that
 * file with `readFileSync`. The mocks below model that: `createRequire(cwd)`
 * resolves to `<cwd>/node_modules/storybook/package.json` (or throws when the
 * cwd has no Storybook), and `readFileSync` serves the version from this map.
 * Reassigning a cwd's version between calls simulates an in-session upgrade —
 * exactly the scenario that used to leave the proxy pinned to a stale version.
 */
let versions: Record<string, string | null> = {};

function moduleNotFound(): NodeJS.ErrnoException {
	return Object.assign(new Error("Cannot find module 'storybook/package.json'"), {
		code: 'MODULE_NOT_FOUND',
	});
}

function pkgPathFor(cwd: string): string {
	return `${cwd}/node_modules/storybook/package.json`;
}

beforeEach(() => {
	versions = {};
	clearStorybookVersionCache();

	vi.mocked(createRequire).mockReset();
	vi.mocked(createRequire).mockImplementation((filename) => {
		const cwd = String(filename).replace(/[/\\]package\.json$/, '');
		const require = (() => {
			throw new Error('unexpected require() call');
		}) as unknown as NodeJS.Require;
		require.resolve = ((id: string) => {
			if (id !== 'storybook/package.json' || versions[cwd] == null) throw moduleNotFound();
			return pkgPathFor(cwd);
		}) as NodeJS.RequireResolve;
		return require;
	});

	vi.mocked(readFileSync).mockReset();
	vi.mocked(readFileSync).mockImplementation((file: Parameters<typeof readFileSync>[0]) => {
		const match = String(file).match(/^(.*)[/\\]node_modules[/\\]storybook[/\\]package\.json$/);
		const cwd = match?.[1];
		if (cwd === undefined || versions[cwd] == null) throw moduleNotFound();
		return JSON.stringify({ version: versions[cwd] });
	});
});

afterEach(() => {
	clearStorybookVersionCache();
});

describe('checkStorybookVersion classification', () => {
	it('returns ok for a current version', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('returns too-old with the detected version for older Storybooks', () => {
		versions['/a'] = '9.1.16';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '9.1.16' });
	});

	it('accepts a prerelease of the minimum (alpha/beta/rc)', () => {
		versions['/a'] = '10.5.0-alpha.1';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('treats a prerelease of an earlier version as too-old', () => {
		versions['/a'] = '10.4.0-rc.1';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '10.4.0-rc.1' });
	});

	it('returns ok for a stable release at or above the minimum', () => {
		versions['/a'] = '10.5.0';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('returns not-installed when storybook is unresolvable', () => {
		expect(checkStorybookVersion('/a')).toEqual({ status: 'not-installed' });
	});

	it('anchors resolution at the cwd, so each cwd sees its own install', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		versions['/b'] = '9.1.16';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'too-old', version: '9.1.16' });
		expect(createRequire).toHaveBeenCalledWith('/a/package.json');
		expect(createRequire).toHaveBeenCalledWith('/b/package.json');
	});
});

describe('checkStorybookVersion caching', () => {
	it('caches the ok result so repeated calls do not re-read the filesystem', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		checkStorybookVersion('/a');
		checkStorybookVersion('/a');
		checkStorybookVersion('/a');
		expect(createRequire).toHaveBeenCalledTimes(1);
		expect(readFileSync).toHaveBeenCalledTimes(1);
	});

	it('does NOT cache too-old, and recovers after an upgrade without a manual clear', () => {
		// First call while Storybook is too old.
		versions['/a'] = '9.1.16';
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '9.1.16' });

		// Simulate an in-session upgrade (pnpm repoints the symlink). NO
		// clearStorybookVersionCache() call — the proxy must re-read on its own.
		versions['/a'] = STORYBOOK_MIN_VERSION;
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('does NOT cache not-installed, and recovers once Storybook is installed', () => {
		expect(checkStorybookVersion('/a')).toEqual({ status: 'not-installed' });
		versions['/a'] = STORYBOOK_MIN_VERSION; // user just ran `storybook init`
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('re-reads disk on every call while too-old (no stale memoization)', () => {
		versions['/a'] = '9.1.16';
		checkStorybookVersion('/a');
		checkStorybookVersion('/a');
		// At least one resolution per call — the too-old verdict is never cached.
		expect(vi.mocked(createRequire).mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('keeps separate cache entries per cwd', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		versions['/b'] = STORYBOOK_MIN_VERSION;
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'ok' });
		vi.mocked(createRequire).mockClear();
		// Both served from cache now.
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'ok' });
		expect(createRequire).not.toHaveBeenCalled();
	});

	it('clearStorybookVersionCache(cwd) forces a re-read of only that cwd', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		versions['/b'] = STORYBOOK_MIN_VERSION;
		checkStorybookVersion('/a');
		checkStorybookVersion('/b');
		vi.mocked(createRequire).mockClear();

		clearStorybookVersionCache('/a');
		checkStorybookVersion('/a'); // re-reads
		checkStorybookVersion('/b'); // still cached
		expect(createRequire).toHaveBeenCalledTimes(1);
	});

	it('clearStorybookVersionCache() with no argument clears every entry', () => {
		versions['/a'] = STORYBOOK_MIN_VERSION;
		versions['/b'] = STORYBOOK_MIN_VERSION;
		checkStorybookVersion('/a');
		checkStorybookVersion('/b');
		vi.mocked(createRequire).mockClear();

		clearStorybookVersionCache();
		checkStorybookVersion('/a'); // re-reads
		checkStorybookVersion('/b'); // re-reads
		expect(createRequire).toHaveBeenCalledTimes(2);
	});
});
