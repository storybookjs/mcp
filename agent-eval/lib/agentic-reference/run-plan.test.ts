import { describe, expect, it } from 'vitest';

import {
	type RunPlan,
	isPlanStoppingSignal,
	narrowedParallelMax,
	parsePlannedExperiments,
	parseResultTimestamp,
	parseSince,
	partitionCachedCells,
	resolveExperimentSelection,
	resolveRunPlan,
	scanResourceSignals,
	stripAnsi,
	topUpCommand,
} from './run-plan.ts';

const EXPERIMENTS = [
	'agentic-ref-cc-control-none-opus-high',
	'agentic-ref-cc-full-opus-high',
	'agentic-ref-cc-docs-full-opus-high',
];

const EVALS = [
	'701-new-ui-flow',
	'702-rework-ui-flow',
	'703-fix-bug-flow',
	'704-fix-a11y-flow',
	'706-new-ui-scheduled-flow',
];

const KNOWN = { experiments: EXPERIMENTS, evals: EVALS };

function plan(overrides: Partial<RunPlan> = {}): RunPlan {
	return {
		experiments: EXPERIMENTS,
		evals: ['701', '702'],
		runs: 10,
		parallelMax: 20,
		...overrides,
	};
}

describe('resolveExperimentSelection', () => {
	it('expands globs while keeping the order the plan listed', () => {
		expect(
			resolveExperimentSelection(['agentic-ref-cc-full-*', EXPERIMENTS[0]!], EXPERIMENTS),
		).toEqual(['agentic-ref-cc-full-opus-high', 'agentic-ref-cc-control-none-opus-high']);
	});

	it('deduplicates names matched by more than one token', () => {
		expect(resolveExperimentSelection(['agentic-ref-*', EXPERIMENTS[1]!], EXPERIMENTS)).toEqual(
			EXPERIMENTS,
		);
	});

	// A token resolving to nothing would run zero cells and report success.
	it('throws on a token that matches no experiment', () => {
		expect(() => resolveExperimentSelection(['agentic-ref-cc-typo'], EXPERIMENTS)).toThrow(
			/matches no known experiment/,
		);
	});

	it('throws on an empty selection', () => {
		expect(() => resolveExperimentSelection([], EXPERIMENTS)).toThrow(/at least one experiment/);
	});
});

describe('resolveRunPlan', () => {
	it('cuts batches eval-major, so a plan cut short leaves a balanced sample', () => {
		const { batches } = resolveRunPlan(plan(), KNOWN);

		expect(batches.map((batch) => [batch.evalName, batch.experiments])).toEqual([
			['701-new-ui-flow', [EXPERIMENTS[0], EXPERIMENTS[1]]],
			['701-new-ui-flow', [EXPERIMENTS[2]]],
			['702-rework-ui-flow', [EXPERIMENTS[0], EXPERIMENTS[1]]],
			['702-rework-ui-flow', [EXPERIMENTS[2]]],
		]);
	});

	it('never starts more sandboxes than parallelMax', () => {
		const { batches, cellsPerBatch } = resolveRunPlan(plan(), KNOWN);

		expect(cellsPerBatch).toBe(2);
		for (const batch of batches) {
			expect(batch.parallel).toBeLessThanOrEqual(20);
		}
	});

	it('numbers batches from 1, across evals', () => {
		const { batches } = resolveRunPlan(plan(), KNOWN);

		expect(batches.map((batch) => batch.index)).toEqual([1, 2, 3, 4]);
	});

	it('widens the batch when the sample is small enough to fit more cells', () => {
		const { cellsPerBatch, batches } = resolveRunPlan(plan({ runs: 5 }), KNOWN);

		expect(cellsPerBatch).toBe(4);
		expect(batches).toHaveLength(2);
		expect(batches[0]!.experiments).toEqual(EXPERIMENTS);
	});

	// A cell's repetitions all start together inside one invocation.
	it('refuses a plan whose sample cannot fit in one batch', () => {
		expect(() => resolveRunPlan(plan({ runs: 30 }), KNOWN)).toThrow(/exceeds parallelMax/);
	});

	it('rejects non-positive-integer knobs', () => {
		expect(() => resolveRunPlan(plan({ runs: 0 }), KNOWN)).toThrow(/runs must be a positive/);
		expect(() => resolveRunPlan(plan({ parallelMax: 2.5 }), KNOWN)).toThrow(
			/parallelMax must be a positive/,
		);
	});

	it('resolves evals in registry order, whatever order the plan listed them', () => {
		const { evals } = resolveRunPlan(plan({ evals: ['703', '701'] }), KNOWN);

		expect(evals).toEqual(['701-new-ui-flow', '703-fix-bug-flow']);
	});

	it('defaults force and ackFailures off', () => {
		expect(resolveRunPlan(plan(), KNOWN).plan).toMatchObject({ force: false, ackFailures: false });
	});
});

describe('the reuse cutoff', () => {
	it('accepts a bare date as UTC midnight, and a full datetime', () => {
		expect(parseSince('2026-08-16')?.toISOString()).toBe('2026-08-16T00:00:00.000Z');
		expect(parseSince('2026-08-16T09:30:00Z')?.toISOString()).toBe('2026-08-16T09:30:00.000Z');
	});

	it('treats an absent or empty cutoff as no cutoff', () => {
		expect(parseSince(undefined)).toBeNull();
		expect(parseSince('  ')).toBeNull();
	});

	it('rejects a date it cannot read, rather than silently reusing everything', () => {
		expect(() => parseSince('last tuesday')).toThrow(/must be an ISO date/);
	});

	it('dates a result directory from its name', () => {
		expect(parseResultTimestamp('2026-08-15T13-20-41.492Z')?.toISOString()).toBe(
			'2026-08-15T13:20:41.492Z',
		);
	});

	it('reads a directory that is not a timestamp as undatable', () => {
		expect(parseResultTimestamp('run-plan-2026-08-15.json')).toBeNull();
		expect(parseResultTimestamp('.tmp')).toBeNull();
	});

	const SINCE = new Date('2026-08-16T00:00:00Z');

	it('re-collects samples that predate the cutoff and keeps the rest', () => {
		const partition = partitionCachedCells(
			[
				{ experiment: 'old', newestSample: new Date('2026-08-15T23:59:59Z') },
				{ experiment: 'exactly-on', newestSample: SINCE },
				{ experiment: 'new', newestSample: new Date('2026-08-17T09:00:00Z') },
			],
			SINCE,
		);

		expect(partition).toEqual({ stale: ['old'], fresh: ['exactly-on', 'new'] });
	});

	// The point of a cutoff is being able to trust what stays in.
	it('treats an undatable sample as stale', () => {
		expect(partitionCachedCells([{ experiment: 'mystery', newestSample: null }], SINCE)).toEqual({
			stale: ['mystery'],
			fresh: [],
		});
	});

	it('keeps every cell when the plan sets no cutoff', () => {
		const partition = partitionCachedCells(
			[
				{ experiment: 'ancient', newestSample: new Date('2020-01-01T00:00:00Z') },
				{ experiment: 'mystery', newestSample: null },
			],
			null,
		);

		expect(partition).toEqual({ stale: [], fresh: ['ancient', 'mystery'] });
	});

	it('resolves the cutoff into a Date, and defaults it to none', () => {
		expect(resolveRunPlan(plan({ since: '2026-08-16' }), KNOWN).plan.since?.toISOString()).toBe(
			'2026-08-16T00:00:00.000Z',
		);
		expect(resolveRunPlan(plan(), KNOWN).plan.since).toBeNull();
	});

	it('fails the whole plan on an unreadable cutoff, before anything runs', () => {
		expect(() => resolveRunPlan(plan({ since: 'yesterday' }), KNOWN)).toThrow(
			/must be an ISO date/,
		);
	});
});

describe('parsePlannedExperiments', () => {
	// The shape agent-eval's dry run prints; a batch is one eval wide, so an
	// experiment listed here has exactly one cell left to collect.
	const DRY_OUTPUT = [
		'Discovered 2 experiment(s):',
		'  - agentic-ref-cc-full-opus-high',
		'',
		'  1 evals to run, 1 cached',
		'',
		'  agentic-ref-cc-full-opus-high      1 to run',
		'                                     → 701-new-ui-flow',
		'  agentic-ref-cc-control-none-opus-high  1 cached',
		'',
	].join('\n');

	it('names only the experiments with work left', () => {
		expect(parsePlannedExperiments(DRY_OUTPUT)).toEqual(['agentic-ref-cc-full-opus-high']);
	});

	it('reads through colour codes', () => {
		const coloured = `  \u001B[37magentic-ref-cc-full-opus-high\u001B[39m\u001B[34m 1 to run\u001B[39m`;

		expect(parsePlannedExperiments(coloured)).toEqual(['agentic-ref-cc-full-opus-high']);
	});

	it('returns nothing for a fully cached plan', () => {
		expect(
			parsePlannedExperiments('  All 4 evals cached across 2 experiments. Nothing to run.'),
		).toEqual([]);
	});
});

describe('scanResourceSignals', () => {
	it('reads the host OOM killer out of a container exit', () => {
		const signals = scanResourceSignals('npm install failed with exit code 137');

		expect(signals).toEqual([
			{ kind: 'memory', evidence: 'npm install failed with exit code 137' },
		]);
	});

	it('recognises a full disk and a dead gateway account', () => {
		expect(scanResourceSignals('Error: ENOSPC: no space left on device')[0]!.kind).toBe('disk');
		expect(scanResourceSignals('AI Gateway: insufficient funds')[0]!.kind).toBe('billing');
	});

	it('reports each kind once, however many lines carry it', () => {
		const signals = scanResourceSignals('OOMKilled\nCannot allocate memory\nENOSPC');

		expect(signals.map((signal) => signal.kind)).toEqual(['memory', 'disk']);
	});

	// Ordinary eval failures are the measurement, not a fault.
	it('stays quiet on a normal failing run', () => {
		expect(scanResourceSignals('  ✗ 701-new-ui-flow run 3/10 failed (assertion)')).toEqual([]);
	});

	it('only stops the plan for conditions every later batch would hit', () => {
		expect(isPlanStoppingSignal({ kind: 'disk', evidence: '' })).toBe(true);
		expect(isPlanStoppingSignal({ kind: 'billing', evidence: '' })).toBe(true);
		expect(isPlanStoppingSignal({ kind: 'memory', evidence: '' })).toBe(false);
	});
});

describe('narrowedParallelMax', () => {
	it('halves, and reports the floor of one cell', () => {
		expect(narrowedParallelMax(20, 10)).toBe(10);
		expect(narrowedParallelMax(40, 5)).toBe(20);
		expect(narrowedParallelMax(10, 10)).toBeNull();
	});
});

describe('topUpCommand', () => {
	it('collects only the missing repetitions, forcing past the cache', () => {
		expect(
			topUpCommand({
				experiment: 'agentic-ref-cc-full-opus-high',
				evalName: '701-new-ui-flow',
				expected: 10,
				collected: 6,
			}),
		).toBe(
			'pnpm eval:agentic-ref --experiments agentic-ref-cc-full-opus-high --evals 701-new-ui-flow --runs 4 --force',
		);
	});
});

describe('stripAnsi', () => {
	it('leaves plain text alone', () => {
		expect(stripAnsi('2 evals to run')).toBe('2 evals to run');
	});
});
