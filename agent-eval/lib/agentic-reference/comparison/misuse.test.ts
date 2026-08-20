import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectMisusePanel } from './misuse.ts';

import type { Run } from '../../post-analysis/discovery.ts';
import type { Cell } from './cells.ts';
import type { ComparisonSpec } from './emit.ts';
import type { ResolvedCase } from './resolve.ts';
import type { DsMisuseReport, JudgedNode } from '../metrics/ds-misuse/types.ts';

const CONTROL: ResolvedCase = {
	caseName: 'cc-control-none-opus-high',
	experiment: 'agentic-ref-cc-control-none-opus-high',
	shortName: 'control-none',
};
const TREATMENT: ResolvedCase = {
	caseName: 'cc-docs-full-opus-high',
	experiment: 'agentic-ref-cc-docs-full-opus-high',
	shortName: 'docs-full',
};
const WF = '701-new-ui-flow';
const TS = '2026-08-01T00-00-00.000Z';

const SPEC: ComparisonSpec = {
	control: CONTROL,
	treatments: [TREATMENT],
	workflows: [WF],
	mode: 'single-workflow',
	minRuns: 1,
};

let results: string;

beforeEach(() => {
	results = mkdtempSync(join(tmpdir(), 'compare-misuse-'));
});
afterEach(() => {
	rmSync(results, { recursive: true, force: true });
});

function judgedNode(overrides: Partial<JudgedNode>): JudgedNode {
	return {
		path: 'App/Card[0]',
		file: 'src/App.tsx',
		line: 10,
		tag: 'Card',
		kind: 'ds',
		...overrides,
	};
}

function misuseReport(nodes: JudgedNode[], dsGuidelinesRef = 'org/ds@abc'): DsMisuseReport {
	const scored = (key: 'correctDsDecision' | 'correctDsUsage' | 'correctLocalDecision') =>
		nodes.flatMap((node) => (node[key] ? [node[key].score] : []));
	const meanOf = (scores: number[]) =>
		scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
	return {
		schemaVersion: 1,
		metricsVersion: 1,
		judgedAt: '2026-08-01T00:00:00.000Z',
		model: 'test-model',
		dsGuidelinesRef,
		fixtureRef: 'org/app@ref',
		diffTruncated: false,
		summary: {
			correctDsDecision: meanOf(scored('correctDsDecision')),
			correctDsUsage: meanOf(scored('correctDsUsage')),
			correctLocalDecision: meanOf(scored('correctLocalDecision')),
			evaluated: {
				ds: nodes.filter((n) => n.kind === 'ds').length,
				local: nodes.filter((n) => n.kind === 'local').length,
			},
		},
		nodes,
	};
}

function usableRun(
	resolved: ResolvedCase,
	run: number,
	report: DsMisuseReport | null,
): Cell['runs'][number] {
	const runDir = join(results, resolved.experiment, TS, WF, `run-${run}`);
	mkdirSync(runDir, { recursive: true });
	if (report !== null) {
		writeFileSync(join(runDir, 'ds-misuse.json'), JSON.stringify(report));
	}
	const runRecord: Run = {
		runDir,
		projectDir: join(runDir, 'project'),
		experiment: resolved.experiment,
		model: 'test-model',
		timestamp: TS,
		evalName: WF,
		run,
		collected: true,
	};
	return { run: runRecord, analysis: {} };
}

function cell(resolved: ResolvedCase, runs: Cell['runs']): Cell {
	return {
		case: resolved,
		workflow: WF,
		runs,
		excluded: [],
		unanalyzed: 0,
		superseded: 0,
		passed: runs.length,
		failed: 0,
	};
}

describe('collectMisusePanel', () => {
	it('pools distributions per cell and keeps every below-perfect verdict as a finding', () => {
		const report = misuseReport([
			judgedNode({
				correctDsDecision: { score: 1, reason: 'Card is the right fit.' },
				correctDsUsage: { score: 0, reason: 'BrandGuidelines.mdx requires tokens; raw hex used.' },
			}),
			judgedNode({
				path: 'App/StatusText[0]',
				tag: 'StatusText',
				kind: 'local',
				line: 20,
				correctLocalDecision: { score: 0.5, reason: 'Badge exists but its API is debatable here.' },
			}),
		]);
		const panel = collectMisusePanel([cell(TREATMENT, [usableRun(TREATMENT, 1, report)])], SPEC);

		expect(panel.judgedRuns).toBe(1);
		expect(panel.usableRuns).toBe(1);
		expect(panel.guidelinesRefs).toEqual(['org/ds@abc']);

		const summary = panel.cells[0]!;
		expect(summary.case).toBe('docs-full');
		expect(summary.questions.correctDsDecision).toEqual({ ones: 1, halves: 0, zeros: 0 });
		expect(summary.questions.correctDsUsage).toEqual({ ones: 0, halves: 0, zeros: 1 });
		expect(summary.questions.correctLocalDecision).toEqual({ ones: 0, halves: 1, zeros: 0 });
		expect(summary.evaluated).toEqual({ ds: 1, local: 1 });

		// Findings carry the reason and sort worst-first.
		expect(panel.findings.map((f) => [f.score, f.tag])).toEqual([
			[0, 'Card'],
			[0.5, 'StatusText'],
		]);
		expect(panel.findings[0]!.reason).toContain('BrandGuidelines.mdx');
		expect(panel.findings[0]!.runLabel).toBe(`${TS}/run-1`);
	});

	it('counts unjudged runs into coverage without inventing scores for them', () => {
		const judged = usableRun(CONTROL, 1, misuseReport([]));
		const unjudged = usableRun(CONTROL, 2, null);
		const panel = collectMisusePanel([cell(CONTROL, [judged, unjudged])], SPEC);

		expect(panel.judgedRuns).toBe(1);
		expect(panel.usableRuns).toBe(2);
		const summary = panel.cells[0]!;
		expect(summary.judged).toBe(1);
		expect(summary.usable).toBe(2);
		// No node got any question: null throughout, never a zero distribution.
		expect(summary.questions.correctDsDecision).toBeNull();
		expect(summary.questions.correctLocalDecision).toBeNull();
	});

	it('surfaces every distinct guideline pin so mixed-standard bundles are visible', () => {
		const a = usableRun(CONTROL, 1, misuseReport([], 'org/ds@old'));
		const b = usableRun(TREATMENT, 1, misuseReport([], 'org/ds@new'));
		const panel = collectMisusePanel([cell(CONTROL, [a]), cell(TREATMENT, [b])], SPEC);
		expect(panel.guidelinesRefs).toEqual(['org/ds@new', 'org/ds@old']);
	});
});
