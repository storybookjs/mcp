import { describe, expect, it } from 'vitest';

import { COMPARISON_METRICS } from '../comparison-metrics.ts';
import type { Cell } from './cells.ts';
import type { ResolvedCase } from './resolve.ts';
import { datasetCsv, manifestJson, type ComparisonSpec } from './emit.ts';

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

const SPEC: ComparisonSpec = {
	control: CONTROL,
	treatments: [TREATMENT],
	workflows: ['703-fix-bug-flow'],
	mode: 'single-workflow',
	minRuns: 1,
	allBatches: false,
};

function cell(resolvedCase: ResolvedCase, values: number[]): Cell {
	return {
		case: resolvedCase,
		workflow: '703-fix-bug-flow',
		batch: '2026-08-05T00-00-00.000Z',
		runs: values.map((v, i) => ({
			run: {
				runDir: `/root/results/${resolvedCase.experiment}/2026-08-05T00-00-00.000Z/703-fix-bug-flow/run-${i + 1}`,
				projectDir: '',
				experiment: resolvedCase.experiment,
				model: '',
				timestamp: '2026-08-05T00-00-00.000Z',
				evalName: '703-fix-bug-flow',
				run: i + 1,
			},
			analysis: { speed: { durationSeconds: v } },
		})),
		excluded: [
			{ runDir: `/root/results/${resolvedCase.experiment}/x/run-9`, reason: 'infra-failure' },
		],
		unanalyzed: 0,
		stale: 0,
		passed: values.length,
		failed: 1,
	};
}

describe('datasetCsv', () => {
	it('emits control rows first with metric columns in registry order', () => {
		const csv = datasetCsv([cell(TREATMENT, [5]), cell(CONTROL, [7])], COMPARISON_METRICS, SPEC);
		const lines = csv.split('\n');
		expect(lines[0]).toBe(
			`case,workflow,batch,run,${COMPARISON_METRICS.map((m) => m.key).join(',')}`,
		);
		expect(lines[1]!.startsWith('control-none,703-fix-bug-flow,2026-08-05T00-00-00.000Z,1,7')).toBe(
			true,
		);
		expect(lines[2]!.startsWith('do-dont,')).toBe(true);
		expect(csv.endsWith('\n')).toBe(true);
		// durationSeconds filled, every other metric column empty
		expect(lines[1]!.split(',').filter((v) => v !== '')).toHaveLength(5);
	});
});

describe('manifestJson', () => {
	it('is canonical: fixed key order, relative paths, provenance last', () => {
		const json = manifestJson({
			spec: SPEC,
			metrics: COMPARISON_METRICS,
			cells: [cell(CONTROL, [7]), cell(TREATMENT, [5])],
			agentEvalRoot: '/root',
			provenance: { generatedAt: 'sometime' },
		});
		const parsed = JSON.parse(json);
		expect(Object.keys(parsed)).toEqual([
			'spec',
			'metrics',
			'family',
			'cells',
			'excludedRuns',
			'provenance',
		]);
		expect(parsed.family[0]).toEqual({ metric: 'durationSeconds', treatment: 'do-dont' });
		expect(parsed.family).toHaveLength(COMPARISON_METRICS.length);
		expect(parsed.excludedRuns[0].path.startsWith('results/')).toBe(true);
		expect(json.endsWith('\n')).toBe(true);
		expect(JSON.stringify(parsed, null, 2) + '\n').toBe(json);
	});

	it('produces identical output for identical input (repeatability)', () => {
		const args = {
			spec: SPEC,
			metrics: COMPARISON_METRICS,
			cells: [cell(CONTROL, [7])],
			agentEvalRoot: '/root',
			provenance: {},
		};
		expect(manifestJson(args)).toBe(manifestJson(args));
	});
});
