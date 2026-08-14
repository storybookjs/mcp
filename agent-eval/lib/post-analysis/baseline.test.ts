import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// prepareRef downloads ~20MB from GitHub; mocked so the suite stays offline.
vi.mock('../agentic-reference/external-repo.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('../agentic-reference/external-repo.ts')>()),
	prepareRef: vi.fn(),
}));

import { prepareRef } from '../agentic-reference/external-repo.ts';
import { baselinePath, loadOrBuildBaselineAnalysis } from './baseline.ts';

import type { PostAnalysis } from './types.ts';

const PIN = { repo: 'owner/name', ref: 'deadbeef' };

let root: string;

function options(overrides: Partial<Parameters<typeof loadOrBuildBaselineAnalysis>[0]> = {}) {
	return {
		pin: PIN,
		baselinesDir: join(root, 'baselines'),
		refCacheDir: join(root, 'refs'),
		postAnalysis: {
			analyzeRun: vi.fn(() => ({ files: { 'a.ts': 1 } })),
			summarize: vi.fn(),
		} as unknown as PostAnalysis,
		...overrides,
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'baseline-lib-'));
	vi.mocked(prepareRef).mockReturnValue(join(root, 'ref-tree'));
	// Rebuilds announce themselves; the suite does not need to hear it.
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('baselinePath', () => {
	it('keys on the pin alone, escaping separators in both halves', () => {
		expect(baselinePath('/b', { repo: 'owner/name', ref: 'heads/main' })).toBe(
			'/b/owner__name@heads__main.json',
		);
	});

	// The point of the re-key: one pin backs many evals, and every one of them
	// produced a byte-identical file under the old scheme.
	it('gives two evals on one pin the same path', () => {
		expect(baselinePath('/b', PIN)).toBe(baselinePath('/b', { ...PIN }));
	});
});

describe('loadOrBuildBaselineAnalysis', () => {
	it('builds via analyzeRun in baseline mode and commits the result', async () => {
		const opts = options();
		const built = await loadOrBuildBaselineAnalysis(opts);

		expect(built.analysis).toEqual({ files: { 'a.ts': 1 } });
		expect(built.dir).toBe(join(root, 'ref-tree'));

		const written = JSON.parse(readFileSync(baselinePath(opts.baselinesDir, PIN), 'utf8'));
		expect(written).toEqual({
			repo: 'owner/name',
			ref: 'deadbeef',
			analysis: { files: { 'a.ts': 1 } },
		});
	});

	it('hands analyzeRun a baseline context of pin and tree only', async () => {
		const opts = options();
		await loadOrBuildBaselineAnalysis(opts);
		expect(opts.postAnalysis.analyzeRun).toHaveBeenCalledWith({
			mode: 'baseline',
			projectDir: join(root, 'ref-tree'),
			pin: PIN,
		});
	});

	it('reads the committed baseline instead of re-measuring the tree', async () => {
		const opts = options();
		const path = baselinePath(opts.baselinesDir, PIN);
		mkdirSync(opts.baselinesDir, { recursive: true });
		writeFileSync(path, JSON.stringify({ ...PIN, analysis: { files: { 'a.ts': 99 } } }));

		const loaded = await loadOrBuildBaselineAnalysis(opts);

		expect(loaded.analysis).toEqual({ files: { 'a.ts': 99 } });
		expect(opts.postAnalysis.analyzeRun).not.toHaveBeenCalled();
	});

	it('reuses a committed baseline whose metricsVersion matches the module', async () => {
		const opts = options({
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: { 'a.ts': 1 } })),
				summarize: vi.fn(),
				metricsVersion: 2,
			} as unknown as PostAnalysis,
		});
		const path = baselinePath(opts.baselinesDir, PIN);
		mkdirSync(opts.baselinesDir, { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				...PIN,
				metricsVersion: 2,
				analysis: { files: { 'a.ts': 99 } },
			}),
		);

		const loaded = await loadOrBuildBaselineAnalysis(opts);

		expect(loaded.analysis).toEqual({ files: { 'a.ts': 99 } });
		expect(opts.postAnalysis.analyzeRun).not.toHaveBeenCalled();
	});

	// A stale baseline is worse than a missing one: its numbers look healthy but
	// were measured under other definitions, skewing every delta against it.
	it('rebuilds a committed baseline measured under another metricsVersion', async () => {
		const opts = options({
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: { 'a.ts': 1 } })),
				summarize: vi.fn(),
				metricsVersion: 2,
			} as unknown as PostAnalysis,
		});
		const path = baselinePath(opts.baselinesDir, PIN);
		mkdirSync(opts.baselinesDir, { recursive: true });
		// A legacy file, from before the module declared a version.
		writeFileSync(path, JSON.stringify({ ...PIN, analysis: { files: { 'a.ts': 99 } } }));

		const rebuilt = await loadOrBuildBaselineAnalysis(opts);

		expect(rebuilt.analysis).toEqual({ files: { 'a.ts': 1 } });
		// The overwritten file now carries the version it was measured under.
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
			repo: 'owner/name',
			ref: 'deadbeef',
			metricsVersion: 2,
			analysis: { files: { 'a.ts': 1 } },
		});
	});

	it('re-measures and overwrites the committed baseline when recompute is set', async () => {
		const opts = options({ recompute: true });
		const path = baselinePath(opts.baselinesDir, PIN);
		mkdirSync(opts.baselinesDir, { recursive: true });
		writeFileSync(path, JSON.stringify({ ...PIN, analysis: { files: { 'a.ts': 99 } } }));

		const rebuilt = await loadOrBuildBaselineAnalysis(opts);

		expect(rebuilt.analysis).toEqual({ files: { 'a.ts': 1 } });
		expect(JSON.parse(readFileSync(path, 'utf8')).analysis).toEqual({ files: { 'a.ts': 1 } });
	});

	it('builds once per pin however many runs ask for it', async () => {
		const opts = options();
		await loadOrBuildBaselineAnalysis(opts);
		await loadOrBuildBaselineAnalysis(opts);
		await loadOrBuildBaselineAnalysis(opts);

		expect(opts.postAnalysis.analyzeRun).toHaveBeenCalledTimes(1);
	});

	// --recompute means "measure fresh", not "measure per run": the second and
	// third runs of an eval must reuse the tree measured moments ago.
	it('re-measures a recomputed pin once, not once per run', async () => {
		const opts = options({ recompute: true });
		await loadOrBuildBaselineAnalysis(opts);
		await loadOrBuildBaselineAnalysis(opts);
		await loadOrBuildBaselineAnalysis(opts);

		expect(opts.postAnalysis.analyzeRun).toHaveBeenCalledTimes(1);
	});

	// The pin is now the whole key, so it has to be a discriminating one: two
	// pins sharing a baselinesDir must not read each other's numbers.
	it('keys by pin, so a second pin gets its own file', async () => {
		const other = { repo: 'owner/name', ref: 'cafebabe' };
		const a = options();
		const b = options({
			pin: other,
			baselinesDir: a.baselinesDir,
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: { 'b.ts': 2 } })),
				summarize: vi.fn(),
			} as unknown as PostAnalysis,
		});

		await loadOrBuildBaselineAnalysis(a);
		expect((await loadOrBuildBaselineAnalysis(b)).analysis).toEqual({ files: { 'b.ts': 2 } });
		expect(existsSync(baselinePath(a.baselinesDir, PIN))).toBe(true);
		expect(existsSync(baselinePath(a.baselinesDir, other))).toBe(true);
	});

	it('rebuilds rather than trusting a truncated baseline', async () => {
		const opts = options();
		mkdirSync(opts.baselinesDir, { recursive: true });
		writeFileSync(baselinePath(opts.baselinesDir, PIN), '{"analysis": {"fi');

		expect((await loadOrBuildBaselineAnalysis(opts)).analysis).toEqual({ files: { 'a.ts': 1 } });
	});

	it('fails loudly when analyzeRun cannot measure the pinned tree', async () => {
		const opts = options({
			postAnalysis: {
				analyzeRun: vi.fn(() => null),
				summarize: vi.fn(),
			} as unknown as PostAnalysis,
		});

		await expect(loadOrBuildBaselineAnalysis(opts)).rejects.toThrow(/owner\/name@deadbeef/);
		expect(existsSync(baselinePath(opts.baselinesDir, PIN))).toBe(false);
	});
});
