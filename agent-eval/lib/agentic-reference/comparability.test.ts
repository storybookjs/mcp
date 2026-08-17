import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	acceptableFingerprints,
	groupComparableRuns,
	parseResultTimestamp,
	readStoredFingerprint,
} from './comparability.ts';

import type { Comparability } from './comparability.ts';

describe('readStoredFingerprint', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'comparability-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function evalDir(summary: string | null): string {
		const dir = join(root, 'eval');
		mkdirSync(dir, { recursive: true });
		if (summary !== null) {
			writeFileSync(join(dir, 'summary.json'), summary);
		}
		return dir;
	}

	it('reads the fingerprint the harness stored beside the runs', () => {
		expect(readStoredFingerprint(evalDir('{"fingerprint":"abc"}'))).toBe('abc');
	});

	// A sample nobody can date or identify is not one this can vouch for, and
	// every caller treats null as "not comparable to anything".
	it('returns null for a missing, malformed or fingerprintless summary', () => {
		expect(readStoredFingerprint(evalDir(null))).toBeNull();
		expect(readStoredFingerprint(evalDir('{'))).toBeNull();
		expect(readStoredFingerprint(evalDir('{"totalRuns":3}'))).toBeNull();
	});
});

describe('acceptableFingerprints', () => {
	// Results outlive the fixtures and arms that produced them: an eval renamed
	// or deleted since a run was collected leaves the run on disk, and the
	// analysis still measures it. Nothing about it is current any more, which is
	// an empty set — not a crash that costs every other cell its analysis.
	it('yields nothing for an eval whose fixture is gone', async () => {
		await expect(
			acceptableFingerprints('agentic-ref-cc-full-opus-high', 'deleted-eval', 3),
		).resolves.toEqual(new Set());
	});

	it('yields nothing for an experiment with no definition on disk', async () => {
		await expect(acceptableFingerprints('deleted-arm', 'deleted-eval', 3)).resolves.toEqual(
			new Set(),
		);
	});
});

describe('parseResultTimestamp', () => {
	it('dates a result directory from its name', () => {
		expect(parseResultTimestamp('2026-08-15T13-20-41.492Z')?.toISOString()).toBe(
			'2026-08-15T13:20:41.492Z',
		);
	});

	it('reads a directory that is not a timestamp as undatable', () => {
		expect(parseResultTimestamp('run-plan-2026-08-15.json')).toBeNull();
		expect(parseResultTimestamp('opus')).toBeNull();
	});
});

describe('groupComparableRuns', () => {
	/** A run, described by hand rather than read off disk. */
	function run(name: string, overrides: Partial<Comparability> = {}) {
		const comparability: Comparability = {
			experiment: 'exp',
			model: '',
			evalName: '701',
			fingerprint: 'fp',
			current: true,
			...overrides,
		};
		return { name, comparability };
	}

	function group(items: ReturnType<typeof run>[]) {
		return groupComparableRuns(items, (item) => item.comparability);
	}

	function names(items: ReturnType<typeof run>[]): string[][] {
		return group(items).map((entry) => entry.members.map((member) => member.name));
	}

	// The point of the whole module: two collections of the same cell are one
	// sample, whatever timestamps they were saved under, and their fingerprints
	// differ because `runs` is hashed into them.
	it('puts runs of one cell together whatever sample size each was collected at', () => {
		expect(
			names([run('monday', { fingerprint: 'fp-10' }), run('friday', { fingerprint: 'fp-4' })]),
		).toEqual([['monday', 'friday']]);
	});

	it('keeps different experiments, models and evals apart', () => {
		expect(
			names([
				run('a'),
				run('b', { experiment: 'other' }),
				run('c', { evalName: '702' }),
				run('d', { model: 'sonnet' }),
			]),
		).toEqual([['a'], ['c'], ['d'], ['b']]);
	});

	// Aggregating these with the current ones would average two measurements of
	// different things and call it one number.
	it('separates runs whose configuration the experiment no longer has', () => {
		expect(names([run('now'), run('before', { current: false, fingerprint: 'old' })])).toEqual([
			['now'],
			['before'],
		]);
	});

	it('separates two superseded generations of one cell from each other', () => {
		expect(
			names([
				run('older', { current: false, fingerprint: 'a' }),
				run('newer', { current: false, fingerprint: 'b' }),
				run('older-again', { current: false, fingerprint: 'a' }),
			]),
		).toEqual([['older', 'older-again'], ['newer']]);
	});

	it('groups samples whose fingerprint could not be read together', () => {
		expect(
			names([
				run('a', { current: false, fingerprint: null }),
				run('b', { current: false, fingerprint: null }),
			]),
		).toEqual([['a', 'b']]);
	});

	// The fingerprint is what tells two superseded generations apart in a header;
	// a current group's samples do not share one, so it carries none.
	it('carries the shared fingerprint of a superseded group and none of a current one', () => {
		const [current, superseded] = group([
			run('now', { fingerprint: 'fp-10' }),
			run('before', { current: false, fingerprint: 'old' }),
		]);
		expect(current).toMatchObject({ current: true, fingerprint: null, experiment: 'exp' });
		expect(superseded).toMatchObject({ current: false, fingerprint: 'old' });
	});

	// Stable output: the same tree analysed twice prints its groups in the same
	// order, current before the generations it replaced.
	it('orders groups by experiment, then eval, then current first', () => {
		const ordered = group([
			run('b-old', { experiment: 'b', current: false, fingerprint: 'x' }),
			run('a-702', { experiment: 'a', evalName: '702' }),
			run('b-now', { experiment: 'b' }),
			run('a-701', { experiment: 'a' }),
		]);
		expect(ordered.map((entry) => entry.members[0]?.name)).toEqual([
			'a-701',
			'a-702',
			'b-now',
			'b-old',
		]);
	});
});
