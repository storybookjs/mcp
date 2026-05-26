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

type RequireFn = ((id: string) => unknown) & { mock?: unknown };

function mockStorybookVersion(version: string | null) {
	vi.mocked(createRequire).mockImplementation(() => {
		const req = ((id: string) => {
			if (id === 'storybook/package.json') {
				if (version === null) throw new Error('not found');
				return { version };
			}
			throw new Error(`unexpected require: ${id}`);
		}) as RequireFn;
		return req as unknown as ReturnType<typeof createRequire>;
	});
}

beforeEach(() => {
	clearStorybookVersionCache();
	vi.mocked(createRequire).mockReset();
});

afterEach(() => {
	clearStorybookVersionCache();
});

describe('checkStorybookVersion caching', () => {
	it('returns ok for a current version', () => {
		mockStorybookVersion(STORYBOOK_MIN_VERSION);
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
	});

	it('returns too-old with the detected version for older Storybooks', () => {
		mockStorybookVersion('9.0.5');
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '9.0.5' });
	});

	it('returns not-installed when storybook is unresolvable', () => {
		mockStorybookVersion(null);
		expect(checkStorybookVersion('/a')).toEqual({ status: 'not-installed' });
	});

	it('caches the result for a given cwd so repeated calls do not hit the filesystem', () => {
		mockStorybookVersion('9.0.5');
		checkStorybookVersion('/a');
		checkStorybookVersion('/a');
		checkStorybookVersion('/a');
		expect(createRequire).toHaveBeenCalledTimes(1);
	});

	it('keeps separate cache entries per cwd', () => {
		const versions: Record<string, string> = { '/a': '9.0.5', '/b': STORYBOOK_MIN_VERSION };
		vi.mocked(createRequire).mockImplementation((cwdPkg) => {
			const cwd = String(cwdPkg).replace(/\/package\.json$/, '');
			const version = versions[cwd];
			const req = ((id: string) => {
				if (id !== 'storybook/package.json') throw new Error('unexpected');
				if (!version) throw new Error('not found');
				return { version };
			}) as RequireFn;
			return req as unknown as ReturnType<typeof createRequire>;
		});
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '9.0.5' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'ok' });
		// Second round: both served from cache.
		vi.mocked(createRequire).mockClear();
		expect(checkStorybookVersion('/a')).toEqual({ status: 'too-old', version: '9.0.5' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'ok' });
		expect(createRequire).not.toHaveBeenCalled();
	});

	it('clearStorybookVersionCache(cwd) re-reads only that cwd on the next call', () => {
		mockStorybookVersion('9.0.5');
		checkStorybookVersion('/a');
		checkStorybookVersion('/b');
		expect(createRequire).toHaveBeenCalledTimes(2);

		mockStorybookVersion(STORYBOOK_MIN_VERSION);
		clearStorybookVersionCache('/a');

		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
		// /b is still cached as too-old.
		expect(checkStorybookVersion('/b')).toEqual({ status: 'too-old', version: '9.0.5' });
		expect(createRequire).toHaveBeenCalledTimes(3);
	});

	it('clearStorybookVersionCache() with no argument clears every entry', () => {
		mockStorybookVersion('9.0.5');
		checkStorybookVersion('/a');
		checkStorybookVersion('/b');
		clearStorybookVersionCache();
		mockStorybookVersion(STORYBOOK_MIN_VERSION);
		expect(checkStorybookVersion('/a')).toEqual({ status: 'ok' });
		expect(checkStorybookVersion('/b')).toEqual({ status: 'ok' });
	});
});
