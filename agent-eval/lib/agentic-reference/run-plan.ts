// Planning logic for scripts/run-plan.ts: turning one plan config into a
// sequence of agent-eval invocations that each fit on this machine.
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
// This module is pure: it resolves selections, cuts batches, and reads meaning
// out of runner output. All the IO — spawning, counting what landed on disk,
// reporting — lives in scripts/run-plan.ts.
import { matchesAnySelector, resolveEvalSelection } from './selection.ts';

/** The `agentic-ref-` prefix generated experiment stubs (and results dirs) carry. */
export const EXPERIMENT_NAME_PREFIX = 'agentic-ref-';

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
	 * Repetitions per (experiment, eval) cell. One invocation collects all of
	 * them: the runner starts a cell's repetitions together and saves them
	 * together, so this is the granularity at which data arrives — and the
	 * granularity at which it can be lost.
	 */
	runs: number;
	/**
	 * Hard ceiling on sandboxes running at once. Empirically 20 on this
	 * hardware; every batch is cut to stay at or under it.
	 */
	parallelMax: number;
	/** Re-collect cells that already have saved results. Default false. */
	force?: boolean;
	/**
	 * Reuse cutoff: an ISO date (`2026-08-16`) or datetime. A cell whose newest
	 * saved sample predates it is re-collected even though the harness would
	 * happily reuse it.
	 *
	 * The harness's own cache keys on a fingerprint of the fixture and the
	 * experiment config, which is blind to everything else the run depends on —
	 * the design-system MCP package a branch resolves to, a template, the sandbox
	 * image, the agent CLI version. This is the knob for those: change the
	 * environment, set the cutoff to the change date, and the runs that predate
	 * it are re-collected while everything since is kept.
	 */
	since?: string;
	/**
	 * Keep infra/timeout runs as final results instead of letting the classifier
	 * delete them. Default false, so infra noise stays out of the sample and the
	 * shortfall shows up as an honest gap in the report.
	 */
	ackFailures?: boolean;
}

/** One agent-eval invocation: a rectangle of the matrix, one eval wide. */
export interface PlanBatch {
	/** 1-based position in the plan. */
	index: number;
	evalName: string;
	experiments: string[];
	/** Sandboxes this batch starts at once: experiments.length × runs. */
	parallel: number;
}

export interface ResolvedPlanOptions {
	runs: number;
	parallelMax: number;
	force: boolean;
	ackFailures: boolean;
	/** The reuse cutoff, or null when the plan sets none. */
	since: Date | null;
}

export interface ResolvedRunPlan {
	plan: ResolvedPlanOptions;
	/** Experiment names, in the order the plan listed them. */
	experiments: string[];
	/** Eval names, in registry order. */
	evals: string[];
	/** Cells per batch: floor(parallelMax / runs). */
	cellsPerBatch: number;
	batches: PlanBatch[];
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
 * Resolves a plan into the batches that will run, eval-major.
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
	// is indivisible here. Splitting it across invocations would mean a second
	// forced invocation appending a fresh sample to the first — a different
	// experiment design, not a smaller batch, so the plan refuses instead of
	// quietly doing it.
	if (runs > parallelMax) {
		throw new Error(
			`runs (${runs}) exceeds parallelMax (${parallelMax}): one cell's repetitions all start ` +
				'at once and cannot be split across invocations. Lower runs or raise parallelMax.',
		);
	}

	const experiments = resolveExperimentSelection(plan.experiments, known.experiments);
	const evals = resolveEvalSelection(plan.evals, known.evals);
	const cellsPerBatch = Math.floor(parallelMax / runs);

	const batches: PlanBatch[] = [];
	for (const evalName of evals) {
		for (let start = 0; start < experiments.length; start += cellsPerBatch) {
			const chunk = experiments.slice(start, start + cellsPerBatch);
			batches.push({
				index: batches.length + 1,
				evalName,
				experiments: chunk,
				parallel: chunk.length * runs,
			});
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
		cellsPerBatch,
		batches,
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

// Result directories are the run's ISO start time with the colons swapped out,
// e.g. 2026-08-15T13-20-41.492Z — so the name is the timestamp, and dating a
// saved sample needs no file reads at all.
const RESULT_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})([.,]\d+)?Z$/;

/** The instant a result directory name stands for, or null if it is not one. */
export function parseResultTimestamp(dirName: string): Date | null {
	const match = RESULT_TIMESTAMP.exec(dirName);
	if (match === null) {
		return null;
	}
	const [, date, hours, minutes, seconds, fraction = ''] = match;
	const parsed = new Date(`${date}T${hours}:${minutes}:${seconds}${fraction.replace(',', '.')}Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A cell the harness would reuse, with the date of the sample it would reuse. */
export interface CachedCell {
	experiment: string;
	/** Newest saved sample for the cell, or null when none could be dated. */
	newestSample: Date | null;
}

export interface CutoffPartition {
	/** Cells to re-collect: their newest sample predates the cutoff. */
	stale: string[];
	/** Cells to keep: their sample is at or after the cutoff. */
	fresh: string[];
}

/**
 * Splits the cells the harness would reuse by the plan's cutoff.
 *
 * Dating a cell by its newest saved sample assumes that sample is the one the
 * harness would reuse. The two only diverge when a *newer* directory exists
 * that the fingerprint rejects — a fixture or config that changed and changed
 * back — and in that case the harness re-runs the cell anyway, so it never
 * reaches this function as cached.
 *
 * An undatable sample counts as stale. A directory that is not a timestamp is
 * not something this can vouch for, and the point of a cutoff is to be able to
 * trust what stays in.
 */
export function partitionCachedCells(
	cached: readonly CachedCell[],
	since: Date | null,
): CutoffPartition {
	if (since === null) {
		return { stale: [], fresh: cached.map((cell) => cell.experiment) };
	}

	const stale: string[] = [];
	const fresh: string[] = [];
	for (const cell of cached) {
		if (cell.newestSample === null || cell.newestSample.getTime() < since.getTime()) {
			stale.push(cell.experiment);
		} else {
			fresh.push(cell.experiment);
		}
	}
	return { stale, fresh };
}

// --- reading the runner's output -------------------------------------------

// chalk disables colour on a pipe, but FORCE_COLOR in the environment overrides
// that, and these patterns all have to match mid-line.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI, '');
}

// The dry-run plan prints one line per experiment that has work left:
// `  <name><padding> N to run[, M cached]`, and a `N cached` line for the rest.
// A batch is one eval wide, so an experiment appearing here means exactly one
// cell of this batch will run — which is how a batch tells "cached, nothing to
// do" apart from "ran and saved nothing".
const PLANNED_EXPERIMENT = /^ {2}(\S+)\s+\d+ to run/;

/** Experiment names the dry-run plan says still have work, in the order printed. */
export function parsePlannedExperiments(output: string): string[] {
	const planned: string[] = [];
	for (const line of stripAnsi(output).split('\n')) {
		const match = PLANNED_EXPERIMENT.exec(line);
		if (match !== null && !planned.includes(match[1]!)) {
			planned.push(match[1]!);
		}
	}
	return planned;
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
	/** Repetitions this batch set out to collect: `runs`, or 0 for a cached cell. */
	expected: number;
	/** Repetitions that reached disk. */
	collected: number;
}

/**
 * The command that collects a cell's missing repetitions.
 *
 * --force is required: the shortfall leaves saved results behind, so the
 * fingerprint cache would treat the cell as done. The top-up lands in its own
 * timestamp directory, which the offline analyzer already walks alongside the
 * first.
 */
export function topUpCommand(cell: CellOutcome): string {
	return (
		`pnpm eval:agentic-ref --experiments ${cell.experiment} --evals ${cell.evalName} ` +
		`--runs ${cell.expected - cell.collected} --force`
	);
}
