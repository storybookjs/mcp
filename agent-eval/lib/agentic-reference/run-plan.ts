// Planning logic for scripts/run-plan.ts: turning one plan config into a
// sequence of agent-eval invocations that each fit on this machine, and that
// collect only the repetitions still missing.
//
// Why a plan runner exists at all. `agent-eval run-all` starts every
// (experiment × eval × run) attempt at once — the runner has no concurrency
// cap, only a start-rate limiter — and it calls saveResults once, after the
// last attempt settles. So a single resource failure that *throws* rather than
// returning a failed run (Docker createContainer, a dockerode socket error, a
// full disk) rejects the runner's Promise.all and unwinds past saveResults,
// discarding every completed sibling run in the same experiment. Locally,
// where the matrix is bounded by RAM and CPU rather than by Vercel's fleet,
// that is the failure that costs a whole afternoon of collection.
//
// Slicing the matrix into batches that each start at most `parallelMax`
// sandboxes caps the blast radius at one batch, because each batch is its own
// invocation with its own saveResults.
//
// WHY THE PLAN COUNTS RUNS ITSELF rather than leaning on the harness's cache:
// that cache is all-or-nothing, and cannot express "this cell has 6 of its 10,
// collect 4 more". The plan counts qualifying runs on disk and asks for the
// difference. A run qualifies when it measures what its cell measures today
// (lib/agentic-reference/comparability.ts) and was saved at or after the plan's
// cutoff.
//
// This module is pure: it resolves selections, decides deficits, and cuts
// batches. All the IO — reading the results tree, spawning, reporting — lives
// in scripts/run-plan.ts.
import { matchesAnySelector, resolveEvalSelection } from './selection.ts';

/**
 * A data-collection plan: which cells to sample, how deeply, and how much of
 * this machine to use at once.
 */
export interface RunPlan {
	/**
	 * Experiments to collect, by full name (`agentic-ref-cc-full-opus-high`) or
	 * glob (`agentic-ref-cc-*`). Names resolve against the case registry, so a
	 * typo fails here rather than widening a paid run.
	 */
	experiments: string[];
	/** Evals to collect, by name, number (703) or glob (70*). */
	evals: string[];
	/**
	 * Target sample size per (experiment, eval) cell. Qualifying runs already on
	 * disk count towards it, so a cell holding 6 of 10 collects 4.
	 */
	runs: number;
	/**
	 * Hard ceiling on sandboxes running at once. Empirically 20 on this
	 * hardware; every batch is cut to stay at or under it.
	 */
	parallelMax: number;
	/**
	 * Ignore what is already on disk and collect the full target for every cell.
	 * Default false.
	 */
	force?: boolean;
	/**
	 * Reuse cutoff: an ISO date (`2026-08-16`) or datetime. Runs saved before it
	 * do not count towards a cell's target.
	 *
	 * For environment changes a measurement cannot see — a rebuilt MCP package at
	 * the same branch, a new sandbox image, a new agent CLI. Set it to the change
	 * date and older runs stop counting.
	 */
	since?: string;
	/**
	 * Keep infra/timeout runs as final results instead of letting the classifier
	 * delete them. Default false, so infra noise stays out of the sample and the
	 * shortfall shows up as an honest gap in the report.
	 */
	ackFailures?: boolean;
}

export interface ResolvedPlanOptions {
	runs: number;
	parallelMax: number;
	force: boolean;
	ackFailures: boolean;
	/** The reuse cutoff, or null when the plan sets none. */
	since: Date | null;
}

/** One (experiment, eval) pair the plan covers. */
export interface PlanCell {
	experiment: string;
	evalName: string;
}

export interface ResolvedRunPlan {
	plan: ResolvedPlanOptions;
	/** Experiment names, in the order the plan listed them. */
	experiments: string[];
	/** Eval names, in registry order. */
	evals: string[];
	/** Every cell the plan covers, eval-major. */
	cells: PlanCell[];
}

/**
 * Expands experiment selection tokens against the known experiment names.
 *
 * Mirrors resolveEvalSelection: a token matching nothing throws, because
 * resolving it to an empty set would read as a successful collection of zero
 * runs — the one outcome this line can least afford to report as a success.
 */
export function resolveExperimentSelection(
	tokens: readonly string[],
	known: readonly string[],
): string[] {
	if (tokens.length === 0) {
		throw new Error('a plan must name at least one experiment.');
	}

	const selected: string[] = [];
	for (const token of tokens) {
		const matches = known.filter((name) => matchesAnySelector(name, [token]));
		if (matches.length === 0) {
			throw new Error(`"${token}" matches no known experiment. Known: ${known.join(', ')}.`);
		}
		for (const match of matches) {
			if (!selected.includes(match)) {
				selected.push(match);
			}
		}
	}
	return selected;
}

function assertPositiveInteger(field: string, value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new Error(`${field} must be a positive integer; received ${JSON.stringify(value)}.`);
	}
	return value;
}

/**
 * Resolves a plan's selections into the cells it covers, eval-major.
 *
 * Eval-major — every experiment for eval A, then every experiment for eval B —
 * so that a plan cut short still holds a balanced sample: each arm has the same
 * evals, which is the comparison the analysis is built on. Experiment-major
 * would leave the last arms with nothing.
 */
export function resolveRunPlan(
	plan: RunPlan,
	known: { experiments: readonly string[]; evals: readonly string[] },
): ResolvedRunPlan {
	const runs = assertPositiveInteger('runs', plan.runs);
	const parallelMax = assertPositiveInteger('parallelMax', plan.parallelMax);

	// A cell's repetitions all start together inside one invocation, so a cell
	// is indivisible here. A deficit is never larger than the target, so this
	// bound covers every batch the plan can cut.
	if (runs > parallelMax) {
		throw new Error(
			`runs (${runs}) exceeds parallelMax (${parallelMax}): one cell's repetitions all start ` +
				'at once and cannot be split across invocations. Lower runs or raise parallelMax.',
		);
	}

	const experiments = resolveExperimentSelection(plan.experiments, known.experiments);
	const evals = resolveEvalSelection(plan.evals, known.evals);

	const cells: PlanCell[] = [];
	for (const evalName of evals) {
		for (const experiment of experiments) {
			cells.push({ experiment, evalName });
		}
	}

	return {
		plan: {
			runs,
			parallelMax,
			force: plan.force ?? false,
			ackFailures: plan.ackFailures ?? false,
			since: parseSince(plan.since),
		},
		experiments,
		evals,
		cells,
	};
}

// --- the reuse cutoff ------------------------------------------------------

/**
 * Reads the `since` cutoff out of a plan config.
 *
 * A bare date means UTC midnight, matching how the result directory names this
 * is compared against are stamped.
 */
export function parseSince(value: string | undefined): Date | null {
	if (value === undefined || value.trim() === '') {
		return null;
	}
	const parsed = new Date(value.trim());
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(
			`since must be an ISO date or datetime (e.g. "2026-08-16"); received "${value}".`,
		);
	}
	return parsed;
}

// --- counting what is already collected ------------------------------------

/** One eval directory found under a result directory. */
export interface StoredSample {
	/** Result directory, relative to the experiment's results directory. */
	dir: string;
	/** When it was collected, from the directory name. */
	at: Date | null;
	/** Whether it measures what its cell measures today. */
	current: boolean;
	/** How many collected runs it holds. */
	runs: number;
}

export type SampleVerdict = 'qualifying' | 'superseded' | 'predates-cutoff' | 'undatable';

/** Whether a stored sample counts towards its cell's target. */
export function judgeSample(sample: StoredSample, since: Date | null): SampleVerdict {
	if (!sample.current) {
		return 'superseded';
	}
	if (since === null) {
		return 'qualifying';
	}
	if (sample.at === null) {
		return 'undatable';
	}
	return sample.at.getTime() < since.getTime() ? 'predates-cutoff' : 'qualifying';
}

/** A cell, with what it already has and what is left to collect. */
export interface CellPlan extends PlanCell {
	/** The plan's target sample size. */
	target: number;
	/** Runs already on disk that count towards the target. */
	qualifying: number;
	/** Runs still to collect. */
	deficit: number;
	/** Runs on disk that do not count, by reason — for explaining the deficit. */
	discounted: Record<Exclude<SampleVerdict, 'qualifying'>, number>;
}

/**
 * Works out how much of a cell is still missing.
 *
 * Qualifying runs are capped at the target: a cell over-collected by an earlier
 * round has a deficit of zero, never a negative one.
 */
export function planCell(
	cell: PlanCell,
	samples: readonly StoredSample[],
	options: { target: number; since: Date | null; force: boolean },
): CellPlan {
	const discounted = { superseded: 0, 'predates-cutoff': 0, undatable: 0 };
	let qualifying = 0;

	if (!options.force) {
		for (const sample of samples) {
			const verdict = judgeSample(sample, options.since);
			if (verdict === 'qualifying') {
				qualifying += sample.runs;
			} else {
				discounted[verdict] += sample.runs;
			}
		}
	}

	qualifying = Math.min(qualifying, options.target);
	return {
		...cell,
		target: options.target,
		qualifying,
		deficit: options.target - qualifying,
		discounted,
	};
}

/** Why a cell has to be collected, in one phrase, for the plan output. */
export function explainDeficit(cell: CellPlan): string {
	const discounted = Object.entries(cell.discounted)
		.filter(([, runs]) => runs > 0)
		.map(([reason, runs]) => `${runs} ${reason.replace('-', ' ')}`);
	const discardedNote = discounted.length === 0 ? '' : ` (discounting ${discounted.join(', ')})`;

	if (cell.qualifying === 0) {
		return `no qualifying runs${discardedNote}`;
	}
	return `${cell.qualifying}/${cell.target} runs already collected${discardedNote}`;
}

// --- batches ---------------------------------------------------------------

/** One agent-eval invocation: cells of one eval, sharing one sample size. */
export interface PlanBatch {
	/** 1-based position in the plan. */
	index: number;
	evalName: string;
	experiments: string[];
	/** Repetitions this invocation asks for — the shared deficit of its cells. */
	runs: number;
	/** Sandboxes it starts at once: experiments.length × runs. */
	parallel: number;
}

/**
 * Cuts the cells that still need work into invocations.
 *
 * One invocation carries a single `--runs`, so cells can only share a batch
 * when their deficits match; within an eval they are grouped by deficit,
 * deepest first, so the cells furthest from a full sample are collected before
 * the shallow top-ups. Batches stay one eval wide, keeping the eval-major order
 * that makes an interrupted plan leave a balanced sample.
 */
export function planBatches(
	cells: readonly CellPlan[],
	evals: readonly string[],
	parallelMax: number,
): PlanBatch[] {
	const batches: PlanBatch[] = [];

	for (const evalName of evals) {
		const outstanding = cells.filter((cell) => cell.evalName === evalName && cell.deficit > 0);

		const byDeficit = new Map<number, string[]>();
		for (const cell of outstanding) {
			const group = byDeficit.get(cell.deficit) ?? [];
			group.push(cell.experiment);
			byDeficit.set(cell.deficit, group);
		}

		for (const deficit of [...byDeficit.keys()].sort((a, b) => b - a)) {
			const experiments = byDeficit.get(deficit)!;
			const perBatch = Math.max(1, Math.floor(parallelMax / deficit));
			for (let start = 0; start < experiments.length; start += perBatch) {
				const chunk = experiments.slice(start, start + perBatch);
				batches.push({
					index: batches.length + 1,
					evalName,
					experiments: chunk,
					runs: deficit,
					parallel: chunk.length * deficit,
				});
			}
		}
	}

	return batches;
}

// --- reading the runner's output -------------------------------------------

// chalk disables colour on a pipe, but FORCE_COLOR in the environment overrides
// that, and these patterns all have to match mid-line.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI, '');
}

export type ResourceSignalKind = 'memory' | 'disk' | 'billing';

export interface ResourceSignal {
	kind: ResourceSignalKind;
	/** The matched line, for the report. */
	evidence: string;
}

// Exit 137 is a SIGKILL, which on an unconstrained Docker container is the host
// OOM killer picking a victim — the sandboxes are created with no memory limit
// of their own, so nothing else reports the pressure.
const SIGNAL_PATTERNS: { kind: ResourceSignalKind; pattern: RegExp }[] = [
	{
		kind: 'memory',
		pattern: /OOMKilled|Cannot allocate memory|\bENOMEM\b|out of memory|exit code 137/i,
	},
	{ kind: 'disk', pattern: /\bENOSPC\b|no space left on device/i },
	{ kind: 'billing', pattern: /insufficient funds/i },
];

/** Resource-exhaustion evidence in a batch's output, deduplicated by kind. */
export function scanResourceSignals(output: string): ResourceSignal[] {
	const found = new Map<ResourceSignalKind, ResourceSignal>();
	for (const line of stripAnsi(output).split('\n')) {
		for (const { kind, pattern } of SIGNAL_PATTERNS) {
			if (!found.has(kind) && pattern.test(line)) {
				found.set(kind, { kind, evidence: line.trim().slice(0, 200) });
			}
		}
	}
	return [...found.values()];
}

/**
 * Signals where continuing would burn wall-clock for nothing: a full disk saves
 * no results, and a billing failure fails identically on every later batch.
 * Memory pressure is not one of them — each batch's containers are gone before
 * the next starts, so the plan keeps collecting and reports a narrower
 * parallelMax at the end.
 */
export function isPlanStoppingSignal(signal: ResourceSignal): boolean {
	return signal.kind === 'disk' || signal.kind === 'billing';
}

/**
 * The parallelMax to suggest after memory pressure: half, but never below one
 * cell, since a batch cannot be cut smaller than a single cell's repetitions.
 * Returns null when already at that floor — there the only remaining knob is
 * `runs`.
 */
export function narrowedParallelMax(parallelMax: number, runs: number): number | null {
	const halved = Math.floor(parallelMax / 2);
	return halved < runs ? null : Math.max(halved, runs);
}

// --- gaps ------------------------------------------------------------------

export interface CellOutcome {
	experiment: string;
	evalName: string;
	/** Repetitions this batch set out to collect. */
	expected: number;
	/** Repetitions that reached disk. */
	collected: number;
}

/**
 * The command that collects a cell's missing repetitions.
 *
 * --force is required: the shortfall leaves saved results behind, so the
 * harness's own cache would treat the cell as done. The top-up lands in its own
 * timestamp directory, which both the plan's own counting and the offline
 * analyzer read alongside the first.
 */
export function topUpCommand(cell: CellOutcome): string {
	return (
		`pnpm eval:agentic-ref --experiments ${cell.experiment} --evals ${cell.evalName} ` +
		`--runs ${cell.expected - cell.collected} --force`
	);
}
