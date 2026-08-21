import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DS_MISUSE_JUDGE_VERSION } from './context.ts';
import { DS_MISUSE_FILENAME, isStale, readMisuseReport, writeMisuseReport } from './index.ts';

import type { DsMisuseReport } from './types.ts';

let runDir: string;

function report(overrides: Partial<DsMisuseReport> = {}): DsMisuseReport {
	return {
		schemaVersion: 1,
		metricsVersion: 7,
		judgeVersion: DS_MISUSE_JUDGE_VERSION,
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

	it('returns null when nodes is not an array', () => {
		mkdirSync(runDir, { recursive: true });
		writeFileSync(
			join(runDir, DS_MISUSE_FILENAME),
			JSON.stringify({ ...report(), nodes: 'not-an-array' }),
		);
		expect(readMisuseReport(runDir)).toBeNull();
	});

	it('returns null when a node answer is a string instead of a scored object', () => {
		mkdirSync(runDir, { recursive: true });
		writeFileSync(
			join(runDir, DS_MISUSE_FILENAME),
			JSON.stringify({
				...report(),
				nodes: [
					{
						path: 'App/A[0]',
						file: 'a.tsx',
						line: 1,
						tag: 'A',
						kind: 'ds',
						correctDsDecision: 'yes',
					},
				],
			}),
		);
		expect(readMisuseReport(runDir)).toBeNull();
	});

	it('returns null when summary is missing', () => {
		mkdirSync(runDir, { recursive: true });
		const { summary: _summary, ...withoutSummary } = report();
		writeFileSync(join(runDir, DS_MISUSE_FILENAME), JSON.stringify(withoutSummary));
		expect(readMisuseReport(runDir)).toBeNull();
	});
});

describe('isStale', () => {
	// Judging costs money; a fresh artifact must not be re-spent on.
	it('is false for an artifact matching the current pin, judge version, and model', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@abc' })).toBe(false);
	});

	// A moved guidelines pin means the run was judged against another standard.
	it('is true when the guidelines pin moved', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@zzz' })).toBe(true);
	});

	// The deterministic metricsVersion only records which census rules built
	// the node paths; it must not invalidate a paid judge artifact.
	it('is NOT stale when only metricsVersion differs', () => {
		expect(
			isStale(report({ metricsVersion: 99 }), { dsGuidelinesRef: 'yannbf/droppy-ds@abc' }),
		).toBe(false);
	});

	it('is true when the judge version moved', () => {
		expect(isStale(report({ judgeVersion: 0 }), { dsGuidelinesRef: 'yannbf/droppy-ds@abc' })).toBe(
			true,
		);
	});

	// An artifact predating the judgeVersion field was produced by judge
	// version 1 and reads as such — never as automatically stale, so a paid
	// judgement is not re-spent just because the stamp arrived after it did.
	it('reads a report lacking judgeVersion as version 1', () => {
		const { judgeVersion: _judgeVersion, ...legacy } = report();
		const stampless = legacy as DsMisuseReport;
		expect(
			isStale({ ...stampless, judgeVersion: 1 }, { dsGuidelinesRef: 'yannbf/droppy-ds@abc' }),
		).toBe(isStale(stampless, { dsGuidelinesRef: 'yannbf/droppy-ds@abc' }));
	});

	it('is true for a report from an older schema', () => {
		expect(isStale(report({ schemaVersion: 0 }), { dsGuidelinesRef: 'yannbf/droppy-ds@abc' })).toBe(
			true,
		);
	});

	// An LLM judge is its model: a different model applied the rubric with a
	// different standard, so its scores must not share a table with fresh ones.
	// Checked directly as a safety net for a model swap that missed a version bump.
	it('is true for a report judged by a different model', () => {
		expect(
			isStale(report({ model: 'claude-opus-4-7' }), { dsGuidelinesRef: 'yannbf/droppy-ds@abc' }),
		).toBe(true);
	});
});
