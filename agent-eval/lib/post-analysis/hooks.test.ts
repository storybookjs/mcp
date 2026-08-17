import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPostAnalysisLoader, postAnalysisFrom } from './hooks.ts';

const COMPLETE = { analyzeRun: vi.fn(), summarize: vi.fn(), deltaToBaseline: vi.fn() };

function experiment(config: unknown) {
	return { default: config };
}

describe('postAnalysisFrom', () => {
	it('returns the module an experiment carries', () => {
		expect(postAnalysisFrom(experiment({ postAnalysis: COMPLETE }), 'arm-a')).toBe(COMPLETE);
	});

	it('accepts a module without the optional delta hook', () => {
		const minimal = { analyzeRun: vi.fn(), summarize: vi.fn() };
		expect(postAnalysisFrom(experiment({ postAnalysis: minimal }), 'arm-a')).toBe(minimal);
	});

	// Identity is what groups arms into one summary table, so two experiments
	// importing the same module must come back as the same object.
	it('preserves identity across experiments sharing a module', () => {
		expect(postAnalysisFrom(experiment({ postAnalysis: COMPLETE }), 'arm-a')).toBe(
			postAnalysisFrom(experiment({ postAnalysis: COMPLETE }), 'arm-b'),
		);
	});

	it.each([
		['an experiment carrying none', experiment({ evals: ['801'] })],
		['an explicit undefined', experiment({ postAnalysis: undefined })],
		['no default export', {}],
		['a non-object default', experiment('nope')],
		['nothing at all', undefined],
	])('returns null for %s', (_label, module) => {
		expect(postAnalysisFrom(module, 'core')).toBeNull();
	});

	// Being skipped is indistinguishable from "not ours to measure", so anything
	// that was clearly meant to be a module has to fail loudly instead.
	it.each([
		['a string', 'post-analysis.ts'],
		['a number', 42],
	])('throws on %s', (_label, value) => {
		expect(() => postAnalysisFrom(experiment({ postAnalysis: value }), 'arm-a')).toThrow(
			/experiments\/arm-a\.ts: postAnalysis must be an object/,
		);
	});

	it.each([
		['analyzeRun', { summarize: vi.fn() }, /must provide an analyzeRun function/],
		['summarize', { analyzeRun: vi.fn() }, /must provide a summarize function/],
	])('names the experiment when %s is missing', (_label, postAnalysis, message) => {
		expect(() => postAnalysisFrom(experiment({ postAnalysis }), 'arm-a')).toThrow(message);
	});

	// A typo'd key would otherwise read as "this module computes no delta".
	it('rejects a non-function deltaToBaseline', () => {
		expect(() =>
			postAnalysisFrom(
				experiment({ postAnalysis: { ...COMPLETE, deltaToBaseline: 'yes' } }),
				'arm-a',
			),
		).toThrow(/deltaToBaseline that is not a function/);
	});

	it('accepts a numeric metricsVersion', () => {
		const versioned = { ...COMPLETE, metricsVersion: 2 };
		expect(postAnalysisFrom(experiment({ postAnalysis: versioned }), 'arm-a')).toBe(versioned);
	});

	// A malformed version would never match a committed baseline, quietly
	// re-measuring the pinned tree on every invocation.
	it('rejects a non-number metricsVersion', () => {
		expect(() =>
			postAnalysisFrom(
				experiment({ postAnalysis: { ...COMPLETE, metricsVersion: 'v2' } }),
				'arm-a',
			),
		).toThrow(/metricsVersion that is not a number/);
	});
});

describe('createPostAnalysisLoader', () => {
	let root: string;

	/** An experiment definition under one of the loader's roots. */
	function define(dir: string, name: string, source: string): void {
		mkdirSync(join(root, dir), { recursive: true });
		writeFileSync(join(root, dir, `${name}.ts`), source);
	}

	function loader() {
		return createPostAnalysisLoader([join(root, 'experiments'), join(root, 'generated')]);
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'hooks-'));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('loads the module an experiment definition carries', async () => {
		define(
			'experiments',
			'arm-a',
			'export default { postAnalysis: { analyzeRun: () => null, summarize: () => [], metricsVersion: 9 } };',
		);
		const loaded = await loader()('arm-a', []);
		expect(loaded?.metricsVersion).toBe(9);
	});

	it('searches the roots in order', async () => {
		define(
			'generated',
			'arm-b',
			'export default { postAnalysis: { analyzeRun: () => null, summarize: () => [], metricsVersion: 3 } };',
		);
		const loaded = await loader()('arm-b', []);
		expect(loaded?.metricsVersion).toBe(3);
	});

	// Results outlive their definitions, and the judge pays a model call per run:
	// a run whose experiment names no module has to come back null before anything
	// reaches for an API key.
	it('returns null for an experiment with no definition on disk', async () => {
		const failures: string[] = [];
		expect(await loader()('deleted-arm', failures)).toBeNull();
		expect(failures).toEqual([]);
	});

	it('returns null for a definition carrying no postAnalysis', async () => {
		define('experiments', 'arm-c', 'export default { evals: ["801"] };');
		expect(await loader()('arm-c', [])).toBeNull();
	});

	// One malformed arm must not cost every other arm its analysis.
	it('records a malformed module as a failure rather than throwing', async () => {
		define('experiments', 'arm-d', 'export default { postAnalysis: { summarize: () => [] } };');
		const failures: string[] = [];
		expect(await loader()('arm-d', failures)).toBeNull();
		expect(failures).toEqual([
			expect.stringMatching(/experiments\/arm-d\.ts:.*must provide an analyzeRun function/),
		]);
	});

	// Reported once, not once per run of the arm.
	it('caches the outcome, including a failure', async () => {
		define('experiments', 'arm-e', 'export default { postAnalysis: { summarize: () => [] } };');
		const load = loader();
		const failures: string[] = [];
		await load('arm-e', failures);
		await load('arm-e', failures);
		expect(failures).toHaveLength(1);
	});

	// Identity is what groups arms into one summary table.
	it('returns the same object for two calls on one experiment', async () => {
		define(
			'experiments',
			'arm-f',
			'export default { postAnalysis: { analyzeRun: () => null, summarize: () => [] } };',
		);
		const load = loader();
		expect(await load('arm-f', [])).toBe(await load('arm-f', []));
	});
});
