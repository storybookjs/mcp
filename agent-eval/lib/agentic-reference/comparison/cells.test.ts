import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRuns } from '../../post-analysis/discovery.ts';
import type { ResolvedCase } from './resolve.ts';
import { autoSelectWorkflows, buildCells } from './cells.ts';
import { copyTaskFixture, measuredResultJson } from './test-fixtures.ts';

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

let results: string;

beforeEach(() => {
	results = mkdtempSync(join(tmpdir(), 'compare-cells-'));
});
afterEach(() => {
	rmSync(results, { recursive: true, force: true });
});

type RunState =
	| 'usable'
	| 'infra'
	| 'unanalyzed'
	| 'outdated-analysis'
	| 'superseded'
	| 'malformed';

function mkRun(experiment: string, timestamp: string, run: number, state: RunState) {
	const dir = join(results, experiment, timestamp, WF, `run-${run}`);
	copyTaskFixture(WF, join(dir, 'project'));
	writeFileSync(
		join(dir, 'result.json'),
		JSON.stringify(
			measuredResultJson(experiment, WF, {
				status: state === 'infra' ? 'failed' : 'passed',
				superseded: state === 'superseded',
			}),
		),
	);
	if (state === 'infra' || state === 'unanalyzed') return;
	if (state === 'malformed') {
		writeFileSync(join(dir, 'analysis.json'), '{not json');
		return;
	}
	writeFileSync(
		join(dir, 'analysis.json'),
		JSON.stringify({ speed: { durationSeconds: 100 + run } }),
	);
	writeFileSync(
		join(dir, 'post-analysis-meta.json'),
		JSON.stringify({
			analyzedAt: 'x',
			...(state === 'outdated-analysis' ? {} : { metricsVersion: 6 }),
			output: {},
		}),
	);
}

function build(overrides: Partial<Parameters<typeof buildCells>[0]> = {}) {
	return buildCells({
		runs: findRuns(results),
		cases: [CONTROL, TREATMENT],
		workflows: [WF],
		minRuns: 2,
		metricsVersion: 6,
		...overrides,
	});
}

describe('buildCells', () => {
	// A pair's sample is topped up across invocations, so its comparable runs
	// span several result directories; a cell is the union of them all.
	it('pools every batch of a cell into one sample', () => {
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS1, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([]);
		expect(cells).toHaveLength(2);
		expect(cells.find((c) => c.case === CONTROL)!.runs).toHaveLength(4);
		expect(cells.find((c) => c.case === TREATMENT)!.runs).toHaveLength(2);
	});

	it('keeps superseded runs of an old batch out of the pooled sample', () => {
		mkRun(CONTROL.experiment, TS1, 1, 'superseded');
		mkRun(CONTROL.experiment, TS1, 2, 'superseded');
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([]);
		const control = cells.find((c) => c.case === CONTROL)!;
		expect(control.runs).toHaveLength(2);
		expect(control.superseded).toBe(2);
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
			{ runDir: join(results, CONTROL.experiment, TS2, WF, 'run-2'), reason: 'infra-failure' },
		]);
	});

	it('keeps superseded runs out of the sample and reports them as the gap', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'superseded');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'superseded-runs' },
		]);
		const control = cells.find((c) => c.case === CONTROL)!;
		expect(control.superseded).toBe(1);
		expect(control.runs).toHaveLength(1);
		// A superseded run belongs to a sample the cell no longer measures, so
		// it does not feed the cell's pass/fail context either.
		expect(control.passed).toBe(1);
	});

	it('counts an analysis stamped by older metrics code as unanalyzed', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'outdated-analysis');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'unanalyzed' }]);
		expect(cells.find((c) => c.case === CONTROL)!.unanalyzed).toBe(1);
	});

	it('classifies unanalyzed and superseded shortfalls distinctly', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'unanalyzed');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'superseded');
		const { gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'unanalyzed' },
			{ case: TREATMENT, workflow: WF, have: 1, need: 2, reason: 'superseded-runs' },
		]);
	});

	it('prefers unanalyzed when analysis alone could close the shortfall', () => {
		// Re-analyzing is free; superseded runs need collection. When either
		// count alone covers the shortfall, the free remediation wins.
		mkRun(CONTROL.experiment, TS2, 1, 'unanalyzed');
		mkRun(CONTROL.experiment, TS2, 2, 'unanalyzed');
		mkRun(CONTROL.experiment, TS2, 3, 'superseded');
		mkRun(CONTROL.experiment, TS2, 4, 'superseded');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { gaps } = build();
		expect(gaps).toEqual([{ case: CONTROL, workflow: WF, have: 0, need: 2, reason: 'unanalyzed' }]);
	});

	it('reports superseded-runs when only both counts together cover the shortfall', () => {
		// minRuns=3, usable=0 -> shortfall=3; unanalyzed=1 alone cannot close
		// it, so collection is needed and supersession is the reason to name.
		mkRun(CONTROL.experiment, TS2, 1, 'unanalyzed');
		mkRun(CONTROL.experiment, TS2, 2, 'superseded');
		mkRun(CONTROL.experiment, TS2, 3, 'superseded');
		for (let i = 1; i <= 3; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { gaps } = build({ minRuns: 3 });
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 0, need: 3, reason: 'superseded-runs' },
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
			runs: findRuns(results),
			cases: [CONTROL, TREATMENT],
			candidates: [WF, '701-new-ui-flow'],
			minRuns: 2,
			metricsVersion: 6,
		});
		expect(selected).toEqual([WF]);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]!.workflow).toBe('701-new-ui-flow');
	});
});
