import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DS_MISUSE_FILENAME, isStale, readMisuseReport, writeMisuseReport } from './index.ts';

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

	it('is true for a report from an older schema', () => {
		expect(
			isStale(report({ schemaVersion: 0 }), {
				dsGuidelinesRef: 'yannbf/droppy-ds@abc',
				metricsVersion: 7,
			}),
		).toBe(true);
	});
});
