import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectMisusePanel, collectMisuseStatuses, formatMisuseStatusTable } from './misuse.ts';
import { dsDocsRefLabel } from '../metrics/ds-misuse/ds-docs.ts';
import { DS_MISUSE_JUDGE_VERSION, JUDGE_MODEL } from '../metrics/ds-misuse/context.ts';
import { DS_MISUSE_SCHEMA_VERSION } from '../metrics/ds-misuse/types.ts';
import { PLAIN_STYLE } from '../style.ts';
import type { OutputStyle } from '../style.ts';

import type { Run } from '../../post-analysis/discovery.ts';
import type { Cell } from './cells.ts';
import type { ComparisonSpec } from './emit.ts';
import type { ResolvedCase } from './resolve.ts';
import type { DsMisuseReport, JudgedNode } from '../metrics/ds-misuse/types.ts';

/** Distinct, greppable markers (not ANSI) so alignment assertions are deterministic. */
const MARKER_STYLE: OutputStyle = {
	bold: (s) => `[B]${s}[/B]`,
	caseName: (s) => `[C]${s}[/C]`,
	tone: (t, s) => `[T:${t}]${s}[/T]`,
	dim: (s) => `[D]${s}[/D]`,
	reason: (r, s) => `[R:${r}]${s}[/R]`,
};

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

function misuseReport(
	nodes: JudgedNode[],
	dsGuidelinesRef = 'org/ds@abc',
	overrides: Partial<DsMisuseReport> = {},
): DsMisuseReport {
	const scored = (key: 'correctDsDecision' | 'correctDsUsage' | 'correctLocalDecision') =>
		nodes.flatMap((node) => (node[key] ? [node[key].score] : []));
	const meanOf = (scores: number[]) =>
		scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length;
	return {
		schemaVersion: 1,
		metricsVersion: 1,
		judgeVersion: DS_MISUSE_JUDGE_VERSION,
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
		...overrides,
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
		const panel = collectMisusePanel([cell(TREATMENT, [usableRun(TREATMENT, 1, report)])], SPEC, {
			repoRoot: results,
		});

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
		const panel = collectMisusePanel([cell(CONTROL, [judged, unjudged])], SPEC, {
			repoRoot: results,
		});

		expect(panel.judgedRuns).toBe(1);
		expect(panel.usableRuns).toBe(2);
		const summary = panel.cells[0]!;
		expect(summary.judged).toBe(1);
		expect(summary.usable).toBe(2);
		// No node got any question: null throughout, never a zero distribution.
		expect(summary.questions.correctDsDecision).toBeNull();
		expect(summary.questions.correctLocalDecision).toBeNull();
	});

	it('attaches the flagged source as an excerpt when the tree holds the file', () => {
		const run = usableRun(
			TREATMENT,
			1,
			misuseReport([
				judgedNode({
					file: 'src/App.tsx',
					line: 3,
					correctDsUsage: { score: 0, reason: 'r' },
				}),
			]),
		);
		mkdirSync(join(run.run.projectDir, 'src'), { recursive: true });
		writeFileSync(
			join(run.run.projectDir, 'src/App.tsx'),
			['a', 'b', 'the flagged line', 'd', 'e'].join('\n'),
		);
		const panel = collectMisusePanel([cell(TREATMENT, [run])], SPEC, { repoRoot: results });
		expect(panel.findings[0]!.excerpt).toEqual({
			start: 1,
			lines: ['a', 'b', 'the flagged line', 'd', 'e'],
		});
	});

	it('omits the excerpt rather than failing when the file is gone', () => {
		const run = usableRun(
			TREATMENT,
			1,
			misuseReport([judgedNode({ correctDsUsage: { score: 0, reason: 'r' } })]),
		);
		const panel = collectMisusePanel([cell(TREATMENT, [run])], SPEC, { repoRoot: results });
		expect(panel.findings[0]!.excerpt).toBeUndefined();
	});

	it('surfaces every distinct guideline pin so mixed-standard bundles are visible', () => {
		const a = usableRun(CONTROL, 1, misuseReport([], 'org/ds@old'));
		const b = usableRun(TREATMENT, 1, misuseReport([], 'org/ds@new'));
		const panel = collectMisusePanel([cell(CONTROL, [a]), cell(TREATMENT, [b])], SPEC, {
			repoRoot: results,
		});
		expect(panel.guidelinesRefs).toEqual(['org/ds@new', 'org/ds@old']);
	});
});

/** A report that passes isStale's check against the current guideline pin, judge version, and model. */
function currentReport(nodes: JudgedNode[] = []): DsMisuseReport {
	return misuseReport(nodes, dsDocsRefLabel(), {
		schemaVersion: DS_MISUSE_SCHEMA_VERSION,
		judgeVersion: DS_MISUSE_JUDGE_VERSION,
		model: JUDGE_MODEL,
	});
}

describe('collectMisuseStatuses', () => {
	it('reports complete when every usable run carries a current judgement', () => {
		const run = usableRun(TREATMENT, 1, currentReport());
		const [status] = collectMisuseStatuses([cell(TREATMENT, [run])], SPEC);
		expect(status).toMatchObject({
			case: 'docs-full',
			workflow: WF,
			usable: 1,
			judged: 1,
			stale: 0,
			status: 'complete',
			label: 'complete',
		});
	});

	it('reports unjudged when no run carries a ds-misuse.json', () => {
		const run = usableRun(TREATMENT, 1, null);
		const [status] = collectMisuseStatuses([cell(TREATMENT, [run])], SPEC);
		expect(status).toMatchObject({ judged: 0, stale: 0, status: 'unjudged', label: 'unjudged' });
	});

	it('reports partial with a j/n label when some but not all runs are judged', () => {
		const judged = usableRun(TREATMENT, 1, currentReport());
		const unjudged = usableRun(TREATMENT, 2, null);
		const [status] = collectMisuseStatuses([cell(TREATMENT, [judged, unjudged])], SPEC);
		expect(status).toMatchObject({
			usable: 2,
			judged: 1,
			stale: 0,
			status: 'partial',
			label: 'partial (1/2 judged)',
		});
	});

	it('reports stale when a ds-misuse.json is present but disqualified by isStale', () => {
		// Judged against a guideline pin other than the current one.
		const run = usableRun(TREATMENT, 1, misuseReport([], 'org/ds@old'));
		const [status] = collectMisuseStatuses([cell(TREATMENT, [run])], SPEC);
		expect(status).toMatchObject({
			usable: 1,
			judged: 0,
			stale: 1,
			status: 'stale',
			label: 'stale (1 stale)',
		});
	});
});

describe('formatMisuseStatusTable', () => {
	it('renders one aligned, styled row per cell', () => {
		const statuses = collectMisuseStatuses(
			[
				cell(CONTROL, [usableRun(CONTROL, 1, currentReport())]),
				cell(TREATMENT, [usableRun(TREATMENT, 1, null)]),
			],
			SPEC,
		);
		const table = formatMisuseStatusTable(statuses, MARKER_STYLE);
		expect(table).toContain('[C]control-none[/C]');
		expect(table).toContain('[T:good]complete[/T]');
		expect(table).toContain('[C]docs-full   [/C]');
		expect(table).toContain('[T:action]unjudged[/T]');
	});

	it('defaults to PLAIN_STYLE, so an unstyled call matches an explicit one', () => {
		const statuses = collectMisuseStatuses(
			[cell(TREATMENT, [usableRun(TREATMENT, 1, null)])],
			SPEC,
		);
		expect(formatMisuseStatusTable(statuses)).toBe(formatMisuseStatusTable(statuses, PLAIN_STYLE));
	});
});
