import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findRuns } from '../../post-analysis/runs.ts';
import type { ResolvedCase } from './resolve.ts';
import { autoSelectWorkflows, buildCells } from './cells.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

const RESULTS = '/results';
const CONTROL: ResolvedCase = {
	caseName: 'cc-control-none-opus-high',
	experiment: 'agentic-ref-cc-control-none-opus-high',
	shortName: 'control-none',
};
const TREATMENT: ResolvedCase = {
	caseName: 'cc-do-dont-opus-high',
	experiment: 'agentic-ref-cc-do-dont-opus-high',
	shortName: 'do-dont',
};
const WF = '703-fix-bug-flow';
const TS1 = '2026-08-01T00-00-00.000Z';
const TS2 = '2026-08-05T00-00-00.000Z';

function mkRun(
	experiment: string,
	timestamp: string,
	run: number,
	state: 'usable' | 'infra' | 'unanalyzed' | 'stale' | 'malformed',
) {
	const dir = `${RESULTS}/${experiment}/${timestamp}/${WF}/run-${run}`;
	vol.fromJSON({ [`${dir}/project/x.txt`]: '' });
	if (state === 'infra') {
		vol.fromJSON({ [`${dir}/result.json`]: JSON.stringify({ status: 'failed' }) });
		return;
	}
	vol.fromJSON({ [`${dir}/result.json`]: JSON.stringify({ status: 'passed' }) });
	if (state === 'unanalyzed') return;
	if (state === 'malformed') {
		vol.fromJSON({ [`${dir}/analysis.json`]: '{not json' });
		return;
	}
	vol.fromJSON({
		[`${dir}/analysis.json`]: JSON.stringify({ speed: { durationSeconds: 100 + run } }),
		[`${dir}/post-analysis-meta.json`]: JSON.stringify({
			analyzedAt: 'x',
			...(state === 'stale' ? {} : { metricsVersion: 6 }),
			output: {},
		}),
	});
}

afterEach(() => {
	vol.reset();
});

function build(overrides: Partial<Parameters<typeof buildCells>[0]> = {}) {
	return buildCells({
		runs: findRuns(RESULTS),
		cases: [CONTROL, TREATMENT],
		workflows: [WF],
		minRuns: 2,
		allBatches: false,
		metricsVersion: 6,
		...overrides,
	});
}

describe('buildCells', () => {
	it('accepts a complete comparison and picks the latest batch', () => {
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS1, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([]);
		expect(cells).toHaveLength(2);
		expect(cells.every((c) => c.batch === TS2)).toBe(true);
		expect(cells[0]!.runs).toHaveLength(2);
	});

	it('pools batches with allBatches', () => {
		mkRun(CONTROL.experiment, TS1, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build({ allBatches: true });
		expect(gaps).toEqual([]);
		expect(cells.find((c) => c.case === CONTROL)!.runs).toHaveLength(2);
		expect(cells.find((c) => c.case === CONTROL)!.batch).toBe('all');
	});

	it('excludes infra failures and reports missing-runs gaps', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'infra');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'missing-runs' },
		]);
		expect(cells.find((c) => c.case === CONTROL)!.excluded).toEqual([
			{ runDir: `${RESULTS}/${CONTROL.experiment}/${TS2}/${WF}/run-2`, reason: 'infra-failure' },
		]);
	});

	it('classifies unanalyzed and stale shortfalls distinctly', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'unanalyzed');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'stale');
		const { gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'unanalyzed' },
			{ case: TREATMENT, workflow: WF, have: 1, need: 2, reason: 'stale-analysis' },
		]);
	});

	it('prefers stale-analysis over unanalyzed when both individually cover the shortfall', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'stale');
		mkRun(CONTROL.experiment, TS2, 3, 'stale');
		mkRun(CONTROL.experiment, TS2, 4, 'unanalyzed');
		mkRun(CONTROL.experiment, TS2, 5, 'unanalyzed');
		for (let i = 1; i <= 3; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { gaps } = build({ minRuns: 3 });
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 3, reason: 'stale-analysis' },
		]);
	});

	it('falls back to stale-analysis when stale and unanalyzed only cover the shortfall together', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'stale');
		mkRun(CONTROL.experiment, TS2, 3, 'stale');
		mkRun(CONTROL.experiment, TS2, 4, 'unanalyzed');
		mkRun(CONTROL.experiment, TS2, 5, 'unanalyzed');
		for (let i = 1; i <= 4; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		// minRuns=4, usable=1 -> shortfall=3; stale=2 and unanalyzed=2 each fall
		// short alone, but their sum (4) covers it, so --recompute (which
		// re-analyzes both) is the right remediation, not a fingerprint-cache
		// no-op eval command.
		const { gaps } = build({ minRuns: 4 });
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 4, reason: 'stale-analysis' },
		]);
	});

	it('treats malformed analysis.json as excluded, not usable', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'malformed');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps[0]).toMatchObject({ reason: 'missing-runs', have: 1 });
		expect(cells.find((c) => c.case === CONTROL)!.excluded[0]).toMatchObject({
			reason: 'malformed-analysis',
		});
	});
});

describe('autoSelectWorkflows', () => {
	it('selects only workflows where every case passes the gate', () => {
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { selected, skipped } = autoSelectWorkflows({
			runs: findRuns(RESULTS),
			cases: [CONTROL, TREATMENT],
			candidates: [WF, '701-new-ui-flow'],
			minRuns: 2,
			allBatches: false,
			metricsVersion: 6,
		});
		expect(selected).toEqual([WF]);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]!.workflow).toBe('701-new-ui-flow');
	});
});
