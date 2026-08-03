import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deltaToBaseline, analyzeRun, summarize } from './post-analysis.ts';
import goldenResult from './__fixtures__/golden-run/result.json' with { type: 'json' };
import goldenTranscript from './__fixtures__/golden-run/transcript.json' with { type: 'json' };

import type {
	BaselineContext,
	DeltaToBaselineContext,
	RunContext,
} from '../post-analysis/types.ts';

const PIN = { repo: 'yannbf/mealdrop', ref: 'ce507b345666ea8678101fccac580186b2b69b1f' };

let root: string;

function writeTree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return dir;
}

function runContext(overrides: Partial<RunContext> = {}): RunContext {
	return {
		mode: 'run',
		runDir: join(root, 'run'),
		projectDir: writeTree('project', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
		}),
		fixtureDir: join(root, 'fixture'),
		experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
		model: 'opus',
		timestamp: '2026-07-28T12-21-43.772Z',
		evalName: '701-agentic-ref-reuse-component-mcp',
		run: 1,
		result: goldenResult,
		transcript: goldenTranscript,
		pin: PIN,
		...overrides,
	};
}

/** A run tree plus the baseline analysis the runner would have loaded for it. */
function deltaContext(
	baselineFiles: Record<string, string>,
	projectFiles: Record<string, string>,
): DeltaToBaselineContext {
	const baselineDir = writeTree('baseline', baselineFiles);
	return {
		...runContext({ projectDir: writeTree('after', projectFiles) }),
		pin: PIN,
		runAnalysis: {},
		baselineDir,
		baselineAnalysis: analyzeRun({
			mode: 'baseline',
			projectDir: baselineDir,
			fixtureDir: join(root, 'fixture'),
			evalName: '701-agentic-ref-reuse-component-mcp',
			pin: PIN,
		} satisfies BaselineContext),
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'post-analysis-'));
	mkdirSync(join(root, 'run'), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('analyzeRun in run mode', () => {
	it('reports the golden run speed, cost and tool-use figures', () => {
		const row = analyzeRun(runContext());

		expect(row.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
		expect(row.cost).toMatchObject({
			inputTokens: 53157,
			outputTokens: 8239,
			totalTokens: 1208645,
			estimatedCostUsd: 1.89273325,
			totalToolCalls: 25,
		});
		expect((row.cost as { cacheHitRate: number }).cacheHitRate).toBeCloseTo(0.833, 4);
		expect(row.toolUse).toMatchObject({
			buckets: { docs: 1, exploration: 14, edit: 8, verification: 7, other: 0 },
		});
		expect((row.churn as { perFile: Record<string, number> }).perFile).toMatchObject({
			'src/components/Footer/Footer.tsx': 3,
		});
	});

	it('carries run identity through to the record', () => {
		expect(analyzeRun(runContext())).toMatchObject({
			experiment: 'agentic-ref-reuse-component-cc-mcp-opus-high',
			eval: '701-agentic-ref-reuse-component-mcp',
			run: 1,
			model: 'opus',
			status: 'failed',
			fixtureRef: 'yannbf/mealdrop@ce507b345666',
		});
	});

	it('measures a run that recorded no pin, leaving fixtureRef null', () => {
		// Nothing here reads the upstream tree, so a missing pin costs only the
		// label; the runner is what refuses to compute a delta without one.
		const row = analyzeRun(runContext({ pin: null }));
		expect(row.fixtureRef).toBeNull();
		expect(row.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
	});

	it('nulls transcript metrics when the transcript has no events', () => {
		const row = analyzeRun(runContext({ transcript: {} }));
		expect(row.toolUse).toBeNull();
		expect(row.churn).toBeNull();
		// Non-transcript metrics still computed.
		expect(row.speed).toEqual({ durationSeconds: 403.365, turns: 12 });
	});

	it('reports nothing comparative, which is deltaToBaseline’s job', () => {
		const row = analyzeRun(runContext());
		expect(row.diff).toBeUndefined();
		expect(row.complexity).toBeUndefined();
	});
});

describe('analyzeRun in baseline mode', () => {
	it('returns per-file complexity for the whole pinned tree', () => {
		const projectDir = writeTree('ref', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
			'src/b.ts': 'function b(){ return 0; }\n',
		});
		const baseline = analyzeRun({
			mode: 'baseline',
			projectDir,
			fixtureDir: join(root, 'fixture'),
			evalName: '701-agentic-ref-reuse-component-mcp',
			pin: PIN,
		});

		const noJsx = { jsxLength: 0, jsxBindings: 0, jsxDepthTotal: 0, jsxTrees: 0 };
		expect(baseline).toEqual({
			files: {
				'src/a.ts': { cyclomatic: 2, cognitive: 1, jsxCyclomatic: 2, jsxCognitive: 1, ...noJsx },
				'src/b.ts': { cyclomatic: 1, cognitive: 0, jsxCyclomatic: 1, jsxCognitive: 0, ...noJsx },
			},
			parseFailures: [],
		});
	});
});

describe('deltaToBaseline', () => {
	it('computes a complexity delta against the baseline', () => {
		// baseline: `function a(){ return 0; }` is cyclomatic 1, cognitive 0.
		// project: adds an `if`, so cyclomatic 2, cognitive 1.
		const delta = deltaToBaseline(
			deltaContext(
				{ 'src/a.ts': 'function a(){ return 0; }\n' },
				{ 'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n' },
			),
		);

		expect(delta.complexity).toMatchObject({
			cyclomatic: { before: 1, after: 2, delta: 1 },
			cognitive: { before: 0, after: 1, delta: 1 },
			parseFailures: [],
		});
		expect((delta.diff as { files: string[] }).files).toEqual(['src/a.ts']);
	});

	it('prices grown markup through the jsx family where the classic metrics barely move', () => {
		const delta = deltaToBaseline(
			deltaContext(
				{ 'src/C.tsx': 'export const C = () => <div>hi</div>;\n' },
				{
					'src/C.tsx': 'export const C = (x) => <div><section>{x ? <A/> : <B/>}</section></div>;\n',
				},
			),
		);

		// The classic metrics see one new ternary. jsxCognitive sees it two
		// elements deep; jsx-structure sees three new tags, a binding, and the
		// tree going from depth 1 to depth 3.
		expect(delta.complexity).toMatchObject({
			cyclomatic: { before: 1, after: 2, delta: 1 },
			cognitive: { before: 0, after: 1, delta: 1 },
			jsxCyclomatic: { before: 1, after: 2, delta: 1 },
			jsxCognitive: { before: 0, after: 4, delta: 4 },
			jsxLength: { before: 1, after: 4, delta: 3 },
			jsxBindings: { before: 0, after: 1, delta: 1 },
			jsxDepth: { before: 1, after: 3, delta: 2 },
		});
	});

	it('nulls jsxDepth when a side has no markup at all', () => {
		const delta = deltaToBaseline(
			deltaContext(
				{ 'src/a.ts': 'function a(){ return 0; }\n' },
				{ 'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n' },
			),
		);

		expect(delta.complexity).toMatchObject({
			jsxDepth: { before: null, after: null, delta: null },
		});
	});

	it('scores a file the agent created as zero before', () => {
		// baseline src/a.ts is cyclomatic 1; the added src/new.ts is 2 and has no
		// baseline entry, so the whole-project total goes 1 -> 3.
		const delta = deltaToBaseline(
			deltaContext(
				{ 'src/a.ts': 'function a(){ return 0; }\n' },
				{
					'src/a.ts': 'function a(){ return 0; }\n',
					'src/new.ts': 'function n(x){ if (x) return 1; return 0; }\n',
				},
			),
		);

		expect(delta.complexity).toMatchObject({
			cyclomatic: { before: 1, after: 3, delta: 2 },
			cognitive: { before: 0, after: 1, delta: 1 },
		});
	});

	// before/after are whole-project totals, not sums over the touched subset:
	// summed over changed files alone they are two arbitrary numbers whose only
	// meaningful content is their difference, and they cannot be compared to
	// another run that happened to touch different files.
	it('reports whole-project totals, counting files the run never touched', () => {
		const untouched = { 'src/untouched.ts': 'function u(x){ if (x) return 1; return 0; }\n' };
		const delta = deltaToBaseline(
			deltaContext(
				{ ...untouched, 'src/a.ts': 'function a(){ return 0; }\n' },
				{ ...untouched, 'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n' },
			),
		);

		// untouched is cyclomatic 2 / cognitive 1 on both sides; a.ts goes 1 -> 2
		// and 0 -> 1. Totals carry untouched; the delta does not.
		expect(delta.complexity).toMatchObject({
			cyclomatic: { before: 3, after: 4, delta: 1 },
			cognitive: { before: 1, after: 2, delta: 1 },
		});
		expect((delta.diff as { files: string[] }).files).toEqual(['src/a.ts']);
	});

	it('drops a deleted file from the after total', () => {
		const delta = deltaToBaseline(
			deltaContext(
				{
					'src/a.ts': 'function a(){ return 0; }\n',
					'src/gone.ts': 'function g(x){ if (x) return 1; return 0; }\n',
				},
				{ 'src/a.ts': 'function a(){ return 0; }\n' },
			),
		);

		expect(delta.complexity).toMatchObject({
			cyclomatic: { before: 3, after: 1, delta: -2 },
			cognitive: { before: 1, after: 0, delta: -1 },
		});
	});

	it('nulls densityPerSloc when no lines changed', () => {
		// Identical trees: sloc.net is 0, so the ratio has no denominator.
		const identical = { 'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n' };
		const delta = deltaToBaseline(deltaContext(identical, identical));

		expect((delta.complexity as { densityPerSloc: number | null }).densityPerSloc).toBeNull();
		expect((delta.diff as { sloc: { net: number } }).sloc.net).toBe(0);
	});

	it('never stores Infinity or NaN', () => {
		const serialised = JSON.stringify(
			deltaToBaseline(
				deltaContext(
					{ 'src/a.ts': 'function a(){ return 0; }\n' },
					{ 'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n' },
				),
			),
		);
		expect(serialised).not.toContain('Infinity');
		expect(serialised).not.toContain('NaN');
	});
});

describe('summarize', () => {
	// summarize prints two tables — one per-run row, one grouped summary row —
	// and returns the grouped rows for the runner to persist. These tests read
	// the printed grouping, the second console.table call.
	function groupedRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
		const spy = vi.spyOn(console, 'table').mockImplementation(() => {});
		try {
			summarize(rows);
			return spy.mock.calls[1]?.[0] as Array<Record<string, unknown>>;
		} finally {
			spy.mockRestore();
		}
	}

	// Returning these is what puts them in results/analysis-summary.json; a
	// summarize that only printed would silently empty that file.
	it('returns the grouped rows, not just printing them', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: 1 },
				speed: { durationSeconds: 10 },
				toolUse: null,
			},
		];
		const spy = vi.spyOn(console, 'table').mockImplementation(() => {});
		try {
			expect(summarize(rows)).toEqual(groupedRowsShape());
		} finally {
			spy.mockRestore();
		}

		function groupedRowsShape() {
			return [
				expect.objectContaining({
					experiment: 'x',
					eval: 'e',
					runs: 1,
					passed: 1,
					fixtureRefs: ['r@1'],
				}),
			];
		}
	});

	it('groups by experiment and eval, and reports means', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: 1 },
				speed: { durationSeconds: 10 },
				toolUse: { buckets: { docs: 2, exploration: 4 } },
				deltaToBaseline: {
					diff: { sloc: { added: 10 } },
					complexity: {
						cognitive: { delta: 3 },
						jsxCognitive: { delta: 7 },
						jsxLength: { delta: 4 },
						jsxDepth: { delta: 1 },
					},
				},
			},
			{
				experiment: 'x',
				eval: 'e',
				status: 'failed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: 3 },
				speed: { durationSeconds: 20 },
				toolUse: { buckets: { docs: 0, exploration: 8 } },
				deltaToBaseline: {
					diff: { sloc: { added: 20 } },
					complexity: {
						cognitive: { delta: 5 },
						jsxCognitive: { delta: 11 },
						jsxLength: { delta: 8 },
						jsxDepth: { delta: 3 },
					},
				},
			},
		];
		const [group] = groupedRows(rows);
		expect(group).toMatchObject({
			experiment: 'x',
			fixtureRef: 'r@1',
			runs: 2,
			passed: 1,
			costUsd: 4,
			secondsMean: 15,
			docsMean: 1,
			slocMean: 15,
			cognitiveMean: 4,
			jsxCogMean: 9,
			jsxDepthMean: 2,
		});
	});

	it('returns the jsx means in the stored rows', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: {},
				speed: {},
				deltaToBaseline: {
					complexity: {
						jsxCognitive: { delta: 7 },
						jsxLength: { delta: 4 },
						jsxDepth: { delta: 1.5 },
					},
				},
			},
		];
		const spy = vi.spyOn(console, 'table').mockImplementation(() => {});
		try {
			expect(summarize(rows)[0]).toMatchObject({
				jsxCognitiveDelta: { mean: 7 },
				jsxLengthDelta: { mean: 4 },
				jsxDepthDelta: { mean: 1.5 },
			});
		} finally {
			spy.mockRestore();
		}
	});

	it('reports null cost rather than zero when no run priced', () => {
		const rows = [
			{
				experiment: 'x',
				eval: 'e',
				status: 'passed',
				fixtureRef: 'r@1',
				cost: { estimatedCostUsd: null },
				speed: {},
				toolUse: null,
			},
		];
		expect(groupedRows(rows)[0]?.costUsd).toBeNull();
	});

	it('survives a row with no delta, e.g. an eval with no baseline', () => {
		const rows = [
			{ experiment: 'x', eval: 'e', status: 'passed', fixtureRef: 'r@1', cost: {}, speed: {} },
		];
		expect(groupedRows(rows)[0]).toMatchObject({
			runs: 1,
			slocMean: null,
			cognitiveMean: null,
			jsxCogMean: null,
			jsxDepthMean: null,
		});
	});

	it('flags a group spanning more than one fixture pin', () => {
		const rows = [
			{ experiment: 'x', eval: 'e', status: 'passed', fixtureRef: 'r@1', cost: {}, speed: {} },
			{ experiment: 'x', eval: 'e', status: 'passed', fixtureRef: 'r@2', cost: {}, speed: {} },
		];
		expect(groupedRows(rows)[0]?.fixtureRef).toBe('mixed (2)');
	});
});
