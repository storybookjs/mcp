import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	checkStorybookVersion,
	classifyStorybookVersion,
	clearStorybookVersionCache,
	STORYBOOK_MIN_VERSION,
} from './version-check.ts';

describe('classifyStorybookVersion (pure)', () => {
	it('returns ok for the minimum version', () => {
		expect(classifyStorybookVersion(STORYBOOK_MIN_VERSION)).toEqual({ status: 'ok' });
	});

	it('returns ok for a stable release above the minimum', () => {
		expect(classifyStorybookVersion('10.6.2')).toEqual({ status: 'ok' });
	});

	it('accepts any prerelease of the minimum (alpha/beta/rc)', () => {
		expect(classifyStorybookVersion('10.5.0-alpha.3')).toEqual({ status: 'ok' });
	});

	it('returns too-old for a version below the floor', () => {
		expect(classifyStorybookVersion('9.1.16')).toEqual({ status: 'too-old', version: '9.1.16' });
	});

	it('treats a prerelease of an earlier version as too-old', () => {
		expect(classifyStorybookVersion('10.4.0-rc.1')).toEqual({
			status: 'too-old',
			version: '10.4.0-rc.1',
		});
	});

	it('returns not-installed for undefined', () => {
		expect(classifyStorybookVersion(undefined)).toEqual({ status: 'not-installed' });
	});
});

describe('checkStorybookVersion (disk fallback)', () => {
	let root: string;

	/** Create a fake Storybook install dir holding the given version. */
	function makeStore(name: string, version: string): string {
		const dir = join(root, 'store', name, 'node_modules', 'storybook');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'storybook', version }));
		return dir;
	}

	/** Point `<cwd>/node_modules/storybook` at the given install dir (symlink). */
	function linkStorybook(cwd: string, target: string): void {
		const nm = join(cwd, 'node_modules');
		mkdirSync(nm, { recursive: true });
		const link = join(nm, 'storybook');
		try {
			unlinkSync(link);
		} catch {
			/* no existing link */
		}
		symlinkSync(target, link, 'dir');
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'sb-version-check-'));
		clearStorybookVersionCache();
	});

	afterEach(() => {
		clearStorybookVersionCache();
		rmSync(root, { recursive: true, force: true });
	});

	it('returns not-installed when Storybook is absent', () => {
		const cwd = join(root, 'proj');
		mkdirSync(cwd, { recursive: true });
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'not-installed' });
	});

	it('reads the installed version (ok / too-old) from disk', () => {
		const cwd = join(root, 'proj');
		mkdirSync(cwd, { recursive: true });
		linkStorybook(cwd, makeStore('sb10', '10.5.0-alpha.4'));
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' });

		clearStorybookVersionCache(cwd);
		linkStorybook(cwd, makeStore('sb9', '9.1.20'));
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'too-old', version: '9.1.20' });
	});

	// The regression that defeated the require.resolve()+readFileSync approach:
	// resolving once while on the old version pins Node's Module._pathCache to the
	// old realpath, so later reads stay stale after a pnpm upgrade. A direct read of
	// node_modules/storybook/package.json follows the live symlink and recovers.
	it('recovers after an in-session symlink swap (the upgrade scenario), no manual clear', () => {
		const cwd = join(root, 'proj');
		mkdirSync(cwd, { recursive: true });
		const sb8 = makeStore('sb8', '8.6.18');
		const sb10 = makeStore('sb10', '10.5.0-alpha.4'); // old dir lingers on disk, like pnpm

		linkStorybook(cwd, sb8);
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'too-old', version: '8.6.18' }); // seeds the trap

		// pnpm upgrade repoints the symlink; the sb8 dir is still present.
		linkStorybook(cwd, sb10);
		// No clearStorybookVersionCache() call -- must recover on its own (too-old is never cached).
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' });
	});
});

describe('checkStorybookVersion caching', () => {
	let root: string;
	let cwd: string;
	function setVersion(version: string) {
		const dir = join(cwd, 'node_modules', 'storybook');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'storybook', version }));
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'sb-version-cache-'));
		cwd = join(root, 'proj');
		mkdirSync(cwd, { recursive: true });
		clearStorybookVersionCache();
	});

	afterEach(() => {
		clearStorybookVersionCache();
		rmSync(root, { recursive: true, force: true });
	});

	it('caches ok (a later on-disk change is not seen until cleared)', () => {
		setVersion('10.5.0');
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' });
		setVersion('9.1.16'); // change on disk
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' }); // served from cache
		clearStorybookVersionCache(cwd);
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'too-old', version: '9.1.16' });
	});

	it('does NOT cache too-old (re-reads disk every call)', () => {
		setVersion('9.1.16');
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'too-old', version: '9.1.16' });
		setVersion('10.5.0'); // upgrade on disk
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' }); // no clear needed
	});

	it('does NOT cache not-installed (recovers once installed)', () => {
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'not-installed' });
		setVersion('10.5.0');
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' });
	});

	it('clearStorybookVersionCache() with no argument clears every entry', () => {
		const other = join(root, 'other');
		mkdirSync(join(other, 'node_modules', 'storybook'), { recursive: true });
		writeFileSync(
			join(other, 'node_modules', 'storybook', 'package.json'),
			JSON.stringify({ name: 'storybook', version: '10.5.0' }),
		);
		setVersion('10.5.0');
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'ok' });
		expect(checkStorybookVersion(other)).toEqual({ status: 'ok' });
		clearStorybookVersionCache();
		// Downgrade both on disk; after a full clear both are re-read.
		writeFileSync(
			join(cwd, 'node_modules', 'storybook', 'package.json'),
			JSON.stringify({ name: 'storybook', version: '9.1.16' }),
		);
		writeFileSync(
			join(other, 'node_modules', 'storybook', 'package.json'),
			JSON.stringify({ name: 'storybook', version: '9.1.16' }),
		);
		expect(checkStorybookVersion(cwd)).toEqual({ status: 'too-old', version: '9.1.16' });
		expect(checkStorybookVersion(other)).toEqual({ status: 'too-old', version: '9.1.16' });
	});
});
