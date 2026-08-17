import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The judge is the one paid call in this tree; no test may reach it. Declared
// through vi.hoisted because vi.mock is lifted above ordinary top-level consts.
const { RUN_JUDGE } = vi.hoisted(() => ({ RUN_JUDGE: vi.fn() }));
vi.mock('./judge.ts', () => ({ runJudge: RUN_JUDGE, assertApiKey: vi.fn() }));

import { dsDocsRefLabel } from './ds-docs.ts';
import {
	DS_MISUSE_FILENAME,
	isStale,
	judgeRun,
	readMisuseReport,
	readUsableMisuseReports,
	writeMisuseReport,
} from './index.ts';

import type { DsMisuseReport } from './types.ts';

let runDir: string;

function report(overrides: Partial<DsMisuseReport> = {}): DsMisuseReport {
	return {
		schemaVersion: 1,
		metricsVersion: 7,
		judgedAt: '2026-08-14T00:00:00.000Z',
		model: 'claude-opus-4-8',
		dsGuidelinesRef: 'yannbf/droppy-ds@abc',
		fixtureRef: 'yannbf/mealdrop@def',
		diffTruncated: false,
		summary: {
			correctDsDecision: 1,
			correctDsUsage: 1,
			correctLocalDecision: null,
			evaluated: { ds: 1, local: 0 },
		},
		nodes: [],
		...overrides,
	};
}

beforeEach(() => {
	runDir = mkdtempSync(join(tmpdir(), 'ds-misuse-'));
});

afterEach(() => {
	rmSync(runDir, { recursive: true, force: true });
});

describe('artifact round-trip', () => {
	it('writes and reads back the report', () => {
		writeMisuseReport(runDir, report());
		expect(readMisuseReport(runDir)).toEqual(report());
	});

	it('returns null when there is none', () => {
		expect(readMisuseReport(runDir)).toBeNull();
	});

	it('returns null for an unreadable artifact rather than throwing', () => {
		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, DS_MISUSE_FILENAME), '{ not json');
		expect(readMisuseReport(runDir)).toBeNull();
	});
});

describe('isStale', () => {
	// Judging costs money; a fresh artifact must not be re-spent on.
	it('is false for an artifact matching the current pins and versions', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@abc', metricsVersion: 7 })).toBe(
			false,
		);
	});

	// A moved guidelines pin means the run was judged against another standard.
	it('is true when the guidelines pin moved', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@zzz', metricsVersion: 7 })).toBe(
			true,
		);
	});

	// A different metricsVersion means the node paths were built differently.
	it('is true when the metrics version moved', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@abc', metricsVersion: 8 })).toBe(
			true,
		);
	});

	// Swapping the judge is a one-line edit. Without this, old and new scores sit
	// in one column differing by grader rather than by the arm being measured.
	it('is true when the judge model moved', () => {
		expect(
			isStale(report({ model: 'claude-opus-4-6' }), {
				dsGuidelinesRef: 'yannbf/droppy-ds@abc',
				metricsVersion: 7,
			}),
		).toBe(true);
	});

	it('is true for a report from an older schema', () => {
		expect(
			isStale(report({ schemaVersion: 0 }), {
				dsGuidelinesRef: 'yannbf/droppy-ds@abc',
				metricsVersion: 7,
			}),
		).toBe(true);
	});
});

describe('readUsableMisuseReports', () => {
	/** A run directory carrying an artifact, current unless overridden. */
	function runWithReport(overrides: Partial<DsMisuseReport> = {}): string {
		const dir = mkdtempSync(join(runDir, 'run-'));
		writeMisuseReport(dir, report({ dsGuidelinesRef: dsDocsRefLabel(), ...overrides }));
		return dir;
	}

	it('returns a current artifact and counts nothing against it', () => {
		const dir = runWithReport();
		const reports = readUsableMisuseReports([{ runDir: dir, metricsVersion: 7 }]);

		expect(reports.byRunDir.get(dir)?.summary.evaluated).toEqual({ ds: 1, local: 0 });
		expect(reports.stale).toBe(0);
		expect(reports.absent).toBe(0);
	});

	// The whole point: a run with no artifact has to be visible as one, not just
	// silently absent from a table.
	it('counts a run with no artifact as absent', () => {
		const dir = mkdtempSync(join(runDir, 'run-'));
		const reports = readUsableMisuseReports([{ runDir: dir, metricsVersion: 7 }]);

		expect(reports.byRunDir.get(dir)).toBeNull();
		expect(reports).toMatchObject({ absent: 1, stale: 0 });
	});

	// Scored against a guidelines pin that has since moved. Printing it beside a
	// fresh score would file two different measurements under one heading.
	it('withholds an artifact judged against a superseded guidelines pin', () => {
		const dir = runWithReport({ dsGuidelinesRef: 'yannbf/droppy-ds@superseded' });
		const reports = readUsableMisuseReports([{ runDir: dir, metricsVersion: 7 }]);

		expect(reports.byRunDir.get(dir)).toBeNull();
		expect(reports).toMatchObject({ stale: 1, absent: 0 });
	});

	// Its node paths were built by other rules, so its buckets mean something else.
	it('withholds an artifact judged under another metricsVersion', () => {
		const dir = runWithReport({ metricsVersion: 6 });
		const reports = readUsableMisuseReports([{ runDir: dir, metricsVersion: 7 }]);

		expect(reports.byRunDir.get(dir)).toBeNull();
		expect(reports).toMatchObject({ stale: 1, absent: 0 });
	});

	// Staleness is judged per run, because the module that measured a run is
	// resolved per experiment and two of them can disagree on the version.
	it('judges each run against its own module version', () => {
		const current = runWithReport({ metricsVersion: 7 });
		const older = runWithReport({ metricsVersion: 6 });

		const reports = readUsableMisuseReports([
			{ runDir: current, metricsVersion: 7 },
			{ runDir: older, metricsVersion: 6 },
		]);

		expect(reports.byRunDir.get(current)).not.toBeNull();
		expect(reports.byRunDir.get(older)).not.toBeNull();
		expect(reports).toMatchObject({ stale: 0, absent: 0 });
	});

	it('reports an entry for every run asked about', () => {
		const dirs = [runWithReport(), mkdtempSync(join(runDir, 'run-'))];
		const reports = readUsableMisuseReports(
			dirs.map((dir) => ({ runDir: dir, metricsVersion: 7 })),
		);
		expect([...reports.byRunDir.keys()].sort()).toEqual([...dirs].sort());
	});
});

describe('judgeRun', () => {
	/** Two identical trees, so the patch between them is empty. */
	function unchangedTrees() {
		const before = mkdtempSync(join(runDir, 'before-'));
		const after = mkdtempSync(join(runDir, 'after-'));
		for (const dir of [before, after]) {
			writeFileSync(join(dir, 'App.tsx'), 'export const App = () => <div />\n');
		}
		return { before, after };
	}

	// censusInclude: [] means "no filter", so an empty patch would census the
	// whole project and send every node in the tree as "treatment" — a whole-tree
	// request, at full token cost, for a run that touched no judgeable file.
	it('returns null without calling the judge when the patch has no files', async () => {
		const { before, after } = unchangedTrees();

		const report = await judgeRun({
			runDir,
			projectDir: after,
			baselineDir: before,
			baselineNodes: [],
			dsPackages: ['@droppy/*'],
			fixtureRef: 'owner/name@ref',
			metricsVersion: 7,
			refCacheDir: join(runDir, 'refs'),
		});

		expect(report).toBeNull();
		expect(RUN_JUDGE).not.toHaveBeenCalled();
	});
});
