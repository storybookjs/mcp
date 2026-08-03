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
		evalName: 'eval-a',
		fixtureDir: join(root, 'fixture'),
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
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.clearAllMocks();
});

describe('baselinePath', () => {
	it('escapes pin separators so each half stays a single path segment', () => {
		expect(baselinePath('/b', 'eval-a', { repo: 'owner/name', ref: 'heads/main' })).toBe(
			'/b/eval-a/owner__name@heads__main.json',
		);
	});
});

describe('loadOrBuildBaselineAnalysis', () => {
	it('builds via analyzeRun in baseline mode and commits the result', async () => {
		const opts = options();
		const built = await loadOrBuildBaselineAnalysis(opts);

		expect(built.analysis).toEqual({ files: { 'a.ts': 1 } });
		expect(built.dir).toBe(join(root, 'ref-tree'));
		expect(opts.postAnalysis.analyzeRun).toHaveBeenCalledWith({
			mode: 'baseline',
			projectDir: join(root, 'ref-tree'),
			fixtureDir: opts.fixtureDir,
			evalName: 'eval-a',
			pin: PIN,
		});

		const written = JSON.parse(
			readFileSync(baselinePath(opts.baselinesDir, 'eval-a', PIN), 'utf8'),
		);
		expect(written).toEqual({
			eval: 'eval-a',
			repo: 'owner/name',
			ref: 'deadbeef',
			analysis: { files: { 'a.ts': 1 } },
		});
	});

	it('reads the committed baseline instead of re-measuring the tree', async () => {
		const opts = options();
		const path = baselinePath(opts.baselinesDir, 'eval-a', PIN);
		mkdirSync(join(opts.baselinesDir, 'eval-a'), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({ eval: 'eval-a', ...PIN, analysis: { files: { 'a.ts': 99 } } }),
		);

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
		const path = baselinePath(opts.baselinesDir, 'eval-a', PIN);
		mkdirSync(join(opts.baselinesDir, 'eval-a'), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				eval: 'eval-a',
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
		const path = baselinePath(opts.baselinesDir, 'eval-a', PIN);
		mkdirSync(join(opts.baselinesDir, 'eval-a'), { recursive: true });
		// A legacy file, from before the module declared a version.
		writeFileSync(
			path,
			JSON.stringify({ eval: 'eval-a', ...PIN, analysis: { files: { 'a.ts': 99 } } }),
		);

		const rebuilt = await loadOrBuildBaselineAnalysis(opts);

		expect(rebuilt.analysis).toEqual({ files: { 'a.ts': 1 } });
		// The overwritten file now carries the version it was measured under.
		expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
			eval: 'eval-a',
			repo: 'owner/name',
			ref: 'deadbeef',
			metricsVersion: 2,
			analysis: { files: { 'a.ts': 1 } },
		});
	});

	it('re-measures and overwrites the committed baseline when recompute is set', async () => {
		const opts = options({ recompute: true });
		const path = baselinePath(opts.baselinesDir, 'eval-a', PIN);
		mkdirSync(join(opts.baselinesDir, 'eval-a'), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({ eval: 'eval-a', ...PIN, analysis: { files: { 'a.ts': 99 } } }),
		);

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

	it('keys by eval as well as pin, since each eval measures its own metrics', async () => {
		const a = options();
		const b = options({
			evalName: 'eval-b',
			baselinesDir: a.baselinesDir,
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: { 'b.ts': 2 } })),
				summarize: vi.fn(),
			} as unknown as PostAnalysis,
		});

		await loadOrBuildBaselineAnalysis(a);
		expect((await loadOrBuildBaselineAnalysis(b)).analysis).toEqual({ files: { 'b.ts': 2 } });
		expect(existsSync(baselinePath(a.baselinesDir, 'eval-a', PIN))).toBe(true);
		expect(existsSync(baselinePath(a.baselinesDir, 'eval-b', PIN))).toBe(true);
	});

	it('rebuilds rather than trusting a truncated baseline', async () => {
		const opts = options();
		mkdirSync(join(opts.baselinesDir, 'eval-a'), { recursive: true });
		writeFileSync(baselinePath(opts.baselinesDir, 'eval-a', PIN), '{"analysis": {"fi');

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
		expect(existsSync(baselinePath(opts.baselinesDir, 'eval-a', PIN))).toBe(false);
	});
});
