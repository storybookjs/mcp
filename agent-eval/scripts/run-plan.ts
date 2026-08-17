#!/usr/bin/env node
// The plan runner: collects a research sample on local hardware without ever
// putting more than `parallelMax` sandboxes on this machine at once.
//
//   pnpm eval:plan --config plans/<name>.plan.ts [--dry]
//
//   --config <path>  the plan config (default AGENTIC_REF_CONFIG, then plans/default.plan.ts)
//   --dry            print the batch plan and spend nothing
//
// A plan config is a TS module default-exporting a RunPlan — experiments,
// evals, runs, parallelMax — see lib/agentic-reference/run-plan.ts and
// plans/example.plan.ts.
//
// WHAT THIS BUYS. `agent-eval run-all` starts the whole matrix at once and
// saves once, at the end, so one resource failure that throws (Docker refusing
// a container, a dockerode socket error, a full disk) unwinds past saveResults
// and discards every completed sibling run with it. On Vercel's fleet that is
// rare; on a laptop at 20 sandboxes it is the normal way an afternoon of
// collection disappears. This script cuts the matrix into batches of
// floor(parallelMax / runs) cells, runs them strictly one after another through
// the existing eval:agentic-ref runner, and so caps the loss at a single batch.
//
// WHY IT SHELLS OUT rather than calling runExperiment directly: the runner
// script already generates the .agentic-ref work directory, links .env.local
// into it, validates the selection against the case registry, and lets the CLI
// do fingerprint reuse, failure classification and housekeeping. Driving it as
// a child process keeps one code path for "run some evals" and gets process
// isolation for free — a batch that dies takes its own process down, not this
// one.
//
// HOW A BATCH IS JUDGED. Not by exit code: `run-all` exits 1 whenever any eval
// has a 0% pass rate, which for a control arm is the measurement, not a fault.
// The verdict comes from disk instead — the run-* directories the batch wrote,
// against the number it planned to write. A cell short of its sample means the
// classifier deleted infra/timeout runs (or the batch died before saving);
// either way the report names the cell and prints the command that tops it up.
//
// Nothing is retried. A batch that fails is recorded and the plan moves on, so
// an unattended overnight run always ends with a complete account of what it
// did and did not collect.
//
// THE REUSE CUTOFF. The harness reuses a saved result when its fingerprint —
// the fixture plus the experiment config — still matches, which is blind to
// everything else a run depends on: the sha a design-system MCP branch resolves
// to, a template, the sandbox image, the agent CLI. A plan's `since` closes
// that gap. Cells whose newest sample predates it are re-collected (forced past
// the cache), cells sampled since are kept, and the report says which was which.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AGENTIC_REF_CASES, AGENTIC_REF_EVAL_REGISTRY } from '../lib/agentic-reference/cases.ts';
import { selectionFlags } from '../lib/agentic-reference/selection.ts';
import {
	type CachedCell,
	type CellOutcome,
	EXPERIMENT_NAME_PREFIX,
	type PlanBatch,
	type ResolvedRunPlan,
	type ResourceSignal,
	type RunPlan,
	isPlanStoppingSignal,
	narrowedParallelMax,
	parsePlannedExperiments,
	parseResultTimestamp,
	partitionCachedCells,
	resolveRunPlan,
	scanResourceSignals,
	topUpCommand,
} from '../lib/agentic-reference/run-plan.ts';

const AGENT_EVAL_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESULTS_DIR = join(AGENT_EVAL_ROOT, 'results');
const RUNNER = join(AGENT_EVAL_ROOT, 'scripts', 'run-agentic-ref.ts');
const DEFAULT_CONFIG = join('plans', 'default.plan.ts');

function fail(message: string): never {
	console.error(`run-plan: ${message}`);
	process.exit(1);
}

// --- batch outcomes --------------------------------------------------------

interface BatchOutcome {
	batch: PlanBatch;
	/** Cells this batch set out to collect. */
	cells: CellOutcome[];
	/** Cells skipped: the harness would reuse them and the cutoff kept them. */
	cached: string[];
	/** Cells re-collected because their saved sample predates the plan's cutoff. */
	invalidated: string[];
	exitCode: number | null;
	durationMs: number;
	signals: ResourceSignal[];
	/** Set when the batch could not be started or judged at all. */
	error?: string;
}

function collectedRuns(outcome: BatchOutcome): number {
	return outcome.cells.reduce((total, cell) => total + cell.collected, 0);
}

function expectedRuns(outcome: BatchOutcome): number {
	return outcome.cells.reduce((total, cell) => total + cell.expected, 0);
}

// --- reading what landed on disk -------------------------------------------

/**
 * Every result directory of an experiment, relative to its results directory.
 *
 * Usually one segment — `<timestamp>` — but an experiment that pins several
 * models saves under `<model>/<timestamp>`, since the CLI names those runs
 * `<experiment>/<model>`. Descending one level keeps such an experiment's runs
 * visible; its cells are then dated and counted across all of its models
 * together, which is the right reading for a plan that selects the experiment
 * as a whole.
 */
function resultDirs(experiment: string): string[] {
	const experimentDir = join(RESULTS_DIR, experiment);
	if (!existsSync(experimentDir)) {
		return [];
	}

	const dirs: string[] = [];
	for (const entry of readdirSync(experimentDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		if (parseResultTimestamp(entry.name) !== null) {
			dirs.push(entry.name);
			continue;
		}
		for (const nested of readdirSync(join(experimentDir, entry.name), { withFileTypes: true })) {
			if (nested.isDirectory()) {
				dirs.push(join(entry.name, nested.name));
			}
		}
	}
	return dirs;
}

/**
 * Repetitions of one cell saved under the timestamp directories a batch added.
 *
 * Scoped to the new directories so a re-collection is never credited with the
 * sample a previous plan run left behind. A missing eval directory counts as
 * zero: that is exactly what the classifier leaves behind when it removes an
 * infra or timeout failure.
 */
function countSavedRuns(experiment: string, evalName: string, newResultDirs: string[]): number {
	let total = 0;
	for (const resultDir of newResultDirs) {
		const evalDir = join(RESULTS_DIR, experiment, resultDir, evalName);
		if (!existsSync(evalDir)) {
			continue;
		}
		total += readdirSync(evalDir, { withFileTypes: true }).filter(
			(entry) => entry.isDirectory() && entry.name.startsWith('run-'),
		).length;
	}
	return total;
}

/**
 * When this cell was last sampled, by the newest result directory that actually
 * holds runs for it.
 *
 * Directories the classifier emptied do not count: a cell whose only recent
 * directory lost its runs to an infra failure has not been sampled recently.
 */
function newestSampleAt(experiment: string, evalName: string): Date | null {
	let newest: Date | null = null;
	for (const resultDir of resultDirs(experiment)) {
		if (countSavedRuns(experiment, evalName, [resultDir]) === 0) {
			continue;
		}
		const at = parseResultTimestamp(basename(resultDir));
		if (at === null) {
			// Undatable, but it does hold runs — partitionCachedCells reads this as
			// stale, which is the safe reading for a cutoff meant to be trusted.
			return null;
		}
		if (newest === null || at.getTime() > newest.getTime()) {
			newest = at;
		}
	}
	return newest;
}

// --- driving the runner ----------------------------------------------------

interface ChildResult {
	exitCode: number | null;
	output: string;
}

/**
 * Runs the agentic-ref runner as a child process.
 *
 * `tee` streams the child's output as it arrives *and* keeps a copy: the copy
 * is what resource signals are scanned out of. Piping costs the CLI's live
 * dashboard (it only renders on a TTY) and falls back to its line-by-line
 * progress handler — the better trade for a multi-hour run whose log is the
 * artifact you keep.
 */
function runRunner(args: string[], tee: boolean): Promise<ChildResult> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, [RUNNER, ...args], {
			cwd: AGENT_EVAL_ROOT,
			env: process.env,
			stdio: ['inherit', 'pipe', 'pipe'],
		});

		let output = '';
		const capture = (stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream) => {
			stream.setEncoding('utf8');
			stream.on('data', (chunk: string) => {
				output += chunk;
				if (tee) {
					sink.write(chunk);
				}
			});
		};
		capture(child.stdout, process.stdout);
		capture(child.stderr, process.stderr);

		child.on('error', rejectPromise);
		child.on('close', (exitCode) => resolvePromise({ exitCode, output }));
	});
}

function runnerArgs(
	experiments: readonly string[],
	batch: PlanBatch,
	resolved: ResolvedRunPlan,
	force: boolean,
): string[] {
	return [
		'--experiments',
		experiments.join(','),
		'--evals',
		batch.evalName,
		'--runs',
		String(resolved.plan.runs),
		...(force ? ['--force'] : []),
		...(resolved.plan.ackFailures ? ['--ack-failures'] : []),
	];
}

/** What a batch has left to do, once the cache and the cutoff have had their say. */
interface BatchWork {
	/** Cells the harness itself means to run: no reusable result, or a stale fingerprint. */
	planned: string[];
	/** Cells the harness would reuse, re-collected anyway because they predate the cutoff. */
	stale: string[];
	/** Cells the harness would reuse and the cutoff kept. */
	fresh: string[];
	/** planned ∪ stale, in batch order. */
	toRun: string[];
	/** Why each cell of toRun has to be collected, keyed by experiment. */
	reasons: Map<string, string>;
	/** Set when the dry pass could not answer, in which case nothing should run. */
	error?: string;
}

/**
 * Decides what a batch has to collect, without collecting anything.
 *
 * The dry pass answers a question the live run cannot: which cells the
 * fingerprint cache will skip. Without it, a cached cell and a cell whose batch
 * died before saving look identical afterwards — both wrote nothing. The cutoff
 * then re-admits the cells whose saved sample is too old to trust.
 */
async function resolveBatchWork(batch: PlanBatch, resolved: ResolvedRunPlan): Promise<BatchWork> {
	const { force, since } = resolved.plan;
	const plan = await runRunner(
		[...runnerArgs(batch.experiments, batch, resolved, force), '--dry'],
		false,
	);
	if (plan.exitCode !== 0) {
		return {
			planned: [],
			stale: [],
			fresh: [],
			toRun: [],
			reasons: new Map(),
			error: `dry pass failed (exit ${plan.exitCode}); nothing was run.\n${plan.output.trim()}`,
		};
	}

	const planned = parsePlannedExperiments(plan.output).filter((name) =>
		batch.experiments.includes(name),
	);

	const sampledAt = new Map(
		batch.experiments.map((experiment) => [experiment, newestSampleAt(experiment, batch.evalName)]),
	);

	// Cells the harness already means to run are not consulted: they have no
	// reusable sample to age out in the first place.
	const reusable: CachedCell[] = batch.experiments
		.filter((name) => !planned.includes(name))
		.map((experiment) => ({ experiment, newestSample: sampledAt.get(experiment) ?? null }));
	const { stale, fresh } = partitionCachedCells(reusable, since);

	// Order follows the batch, so logs and the report read the same way however
	// the groups interleave.
	const toRun = batch.experiments.filter((name) => planned.includes(name) || stale.includes(name));

	const reasons = new Map(
		toRun.map((experiment) => [experiment, collectionReason(experiment, sampledAt, stale)]),
	);

	return { planned, stale, fresh, toRun, reasons };
}

/** A saved sample's date, to the minute — enough to line up against a cutoff. */
function formatSample(at: Date): string {
	return `${at.toISOString().slice(0, 16)}Z`;
}

/**
 * Why a cell has to be collected.
 *
 * The three answers are worth telling apart. "Never collected" is the plain
 * case. A sample the *harness* rejects means its fingerprint moved — the
 * fixture or the experiment config changed since — and the cutoff had no say.
 * A sample the *cutoff* rejects is the one the plan chose to invalidate. Only
 * the last is the plan's own doing, so reporting all three as one number is how
 * a repinned fixture gets mistaken for a broken cutoff.
 */
function collectionReason(
	experiment: string,
	sampledAt: ReadonlyMap<string, Date | null>,
	stale: readonly string[],
): string {
	const sample = sampledAt.get(experiment) ?? null;
	if (stale.includes(experiment)) {
		return sample === null
			? 'saved sample cannot be dated'
			: `sample ${formatSample(sample)} predates the cutoff`;
	}
	return sample === null
		? 'never collected'
		: `sample ${formatSample(sample)} superseded — fixture or experiment config changed since`;
}

function describeWork(work: BatchWork): void {
	if (work.fresh.length > 0) {
		console.log(`  already collected: ${work.fresh.join(', ')}`);
	}
	for (const experiment of work.toRun) {
		console.log(`  collecting ${experiment}: ${work.reasons.get(experiment) ?? 'unknown'}`);
	}
}

async function runBatch(batch: PlanBatch, resolved: ResolvedRunPlan): Promise<BatchOutcome> {
	const started = Date.now();
	const work = await resolveBatchWork(batch, resolved);

	if (work.error !== undefined) {
		return {
			batch,
			cells: [],
			cached: [],
			invalidated: [],
			exitCode: null,
			durationMs: Date.now() - started,
			signals: [],
			error: work.error,
		};
	}

	const { stale, fresh, toRun } = work;

	if (toRun.length === 0) {
		console.log('  already collected — skipping.');
		return {
			batch,
			cells: [],
			cached: fresh,
			invalidated: [],
			exitCode: 0,
			durationMs: Date.now() - started,
			signals: [],
		};
	}
	describeWork(work);

	// --force is what makes a stale cell re-run at all: the harness's cache would
	// otherwise skip it. Cells in `planned` would have run either way, so forcing
	// the whole invocation costs nothing — toRun holds only cells that need work.
	const before = new Map(toRun.map((name) => [name, new Set(resultDirs(name))]));
	const run = await runRunner(
		runnerArgs(toRun, batch, resolved, resolved.plan.force || stale.length > 0),
		true,
	);

	const cells: CellOutcome[] = toRun.map((experiment) => {
		const added = resultDirs(experiment).filter((name) => !before.get(experiment)!.has(name));
		return {
			experiment,
			evalName: batch.evalName,
			expected: resolved.plan.runs,
			collected: countSavedRuns(experiment, batch.evalName, added),
		};
	});

	return {
		batch,
		cells,
		cached: fresh,
		invalidated: stale,
		exitCode: run.exitCode,
		durationMs: Date.now() - started,
		signals: scanResourceSignals(run.output),
	};
}

// --- reporting -------------------------------------------------------------

function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function describeBatch(batch: PlanBatch, total: number, runs: number): string {
	return (
		`[${batch.index}/${total}] ${batch.evalName} × ${batch.experiments.join(', ')} ` +
		`(${batch.experiments.length} cell(s) × ${runs} runs = ${batch.parallel} sandboxes)`
	);
}

function printPlan(resolved: ResolvedRunPlan): void {
	const { plan, batches, experiments, evals, cellsPerBatch } = resolved;
	const cells = experiments.length * evals.length;
	console.log(
		`Plan: ${experiments.length} experiment(s) × ${evals.length} eval(s) × ${plan.runs} run(s) ` +
			`= ${cells} cells, ${cells * plan.runs} runs total.`,
	);
	console.log(
		`Batches: ${batches.length}, at most ${cellsPerBatch} cell(s) ` +
			`(${cellsPerBatch * plan.runs} sandboxes) at once, parallelMax ${plan.parallelMax}.`,
	);
	if (plan.force) {
		console.log('force: re-collecting cells that already have results.');
	} else if (plan.since !== null) {
		console.log(
			`since ${plan.since.toISOString()}: cells whose newest sample predates this are re-collected.`,
		);
	}
	if (plan.ackFailures) {
		console.log('ackFailures: infra and timeout runs are kept as final results.');
	}
	console.log('');
	for (const batch of batches) {
		console.log(`  ${describeBatch(batch, batches.length, plan.runs)}`);
	}
	console.log('');
}

type StopReason = 'resource' | 'interrupt';

interface PlanReport {
	startedAt: string;
	completedAt: string;
	config: string;
	plan: Omit<ResolvedRunPlan['plan'], 'since'> & { since: string | null };
	batches: BatchOutcome[];
	gaps: CellOutcome[];
	stoppedAt: number | null;
	stoppedBy: StopReason | null;
	recommendedParallelMax: number | null;
}

function printReport(report: PlanReport, totalBatches: number): void {
	const { batches, gaps } = report;
	console.log('\n' + '─'.repeat(72));
	console.log('run-plan summary\n');

	for (const outcome of batches) {
		const label = `[${outcome.batch.index}/${totalBatches}] ${outcome.batch.evalName}`;
		if (outcome.error !== undefined) {
			console.log(`  ${label}  ERROR — ${outcome.error.split('\n')[0]}`);
			continue;
		}
		if (outcome.cells.length === 0) {
			console.log(`  ${label}  cached, nothing to collect`);
			continue;
		}
		const collected = collectedRuns(outcome);
		const expected = expectedRuns(outcome);
		const state = collected === expected ? 'ok' : `GAP ${expected - collected} run(s)`;
		console.log(
			`  ${label}  ${collected}/${expected} runs  ${formatDuration(outcome.durationMs)}  ${state}`,
		);
	}

	const totalCollected = batches.reduce((sum, outcome) => sum + collectedRuns(outcome), 0);
	const totalExpected = batches.reduce((sum, outcome) => sum + expectedRuns(outcome), 0);
	console.log(`\n  Collected ${totalCollected}/${totalExpected} planned runs.`);

	const invalidated = batches.flatMap((outcome) =>
		outcome.invalidated.map((experiment) => `${outcome.batch.evalName} × ${experiment}`),
	);
	const kept = batches.reduce((sum, outcome) => sum + outcome.cached.length, 0);
	if (report.plan.since !== null) {
		console.log(
			`  Cutoff ${report.plan.since}: re-collected ${invalidated.length} cell(s), ` +
				`kept ${kept} already-collected cell(s).`,
		);
		for (const cell of invalidated) {
			console.log(`    re-collected ${cell}`);
		}
	}

	if (gaps.length > 0) {
		console.log(`\n  Gaps (${gaps.length} cell(s) short of their sample):`);
		for (const cell of gaps) {
			console.log(
				`    ${cell.evalName} × ${cell.experiment}  ${cell.collected}/${cell.expected} runs`,
			);
			console.log(`      ${topUpCommand(cell)}`);
		}
		console.log(
			'\n  A shortfall means the classifier removed infra or timeout runs, or the batch died\n' +
				'  before saving. The commands above collect the missing repetitions into a new\n' +
				'  timestamp directory; the offline analyzer reads them alongside the first.',
		);
	}

	const signals = batches.flatMap((outcome) =>
		outcome.signals.map((signal) => ({ batch: outcome.batch.index, signal })),
	);
	if (signals.length > 0) {
		console.log('\n  Resource signals:');
		for (const { batch, signal } of signals) {
			console.log(`    batch ${batch}  ${signal.kind}: ${signal.evidence}`);
		}
	}

	if (report.recommendedParallelMax !== null) {
		console.log(
			`\n  Memory pressure was observed. Set parallelMax: ${report.recommendedParallelMax} ` +
				`in the plan config for future runs.`,
		);
	} else if (signals.some(({ signal }) => signal.kind === 'memory')) {
		console.log(
			`\n  Memory pressure was observed, but parallelMax is already at one cell ` +
				`(${report.plan.runs} sandboxes). Lower runs to shrink batches further.`,
		);
	}

	if (report.stoppedAt !== null) {
		const why =
			report.stoppedBy === 'interrupt'
				? 'interrupted'
				: 'the remaining batches would fail the same way';
		console.log(
			`\n  Plan stopped after batch ${report.stoppedAt} of ${totalBatches} (${why}).\n` +
				'  Re-run the same config to continue — collected cells are cached and skipped.',
		);
	}

	console.log('─'.repeat(72));
}

/**
 * Resolves every batch without running any, and prints what each would collect.
 *
 * Free — each batch costs one dry pass — and it is the only way to see the
 * cutoff's effect before paying for it: how many cells it re-admits, and how
 * many the cache still covers.
 */
async function printDryWork(resolved: ResolvedRunPlan): Promise<void> {
	let toRun = 0;
	let stale = 0;
	let fresh = 0;

	for (const batch of resolved.batches) {
		const work = await resolveBatchWork(batch, resolved);
		const label = `[${batch.index}/${resolved.batches.length}] ${batch.evalName}`;
		if (work.error !== undefined) {
			console.log(`  ${label}  ERROR — ${work.error.split('\n')[0]}`);
			continue;
		}
		toRun += work.toRun.length;
		stale += work.stale.length;
		fresh += work.fresh.length;
		console.log(
			`  ${label}  ${work.toRun.length} to collect` +
				(work.stale.length > 0 ? `, ${work.stale.length} past the cutoff` : '') +
				(work.fresh.length > 0 ? `, ${work.fresh.length} cached` : ''),
		);
		for (const experiment of work.toRun) {
			console.log(`      → ${experiment} (${work.reasons.get(experiment) ?? 'unknown'})`);
		}
	}

	console.log(
		`\n  ${toRun} cell(s) to collect — ${toRun * resolved.plan.runs} runs — of which ` +
			`${stale} re-admitted by the cutoff. ${fresh} cell(s) already covered.`,
	);
}

function writeReport(report: PlanReport): string {
	mkdirSync(RESULTS_DIR, { recursive: true });
	const stamp = report.startedAt.replace(/[:.]/g, '-');
	const path = join(RESULTS_DIR, `run-plan-${stamp}.json`);
	writeFileSync(path, JSON.stringify(report, null, 2));
	return path;
}

// --- config loading --------------------------------------------------------

/** Experiment names the generated stubs (and results directories) carry. */
function knownExperiments(): string[] {
	return AGENTIC_REF_CASES.map(
		(agenticRefCase) => `${EXPERIMENT_NAME_PREFIX}${agenticRefCase.name}`,
	);
}

async function loadPlanConfig(configPath: string): Promise<RunPlan> {
	if (!existsSync(configPath)) {
		fail(`no plan config at ${relative(AGENT_EVAL_ROOT, configPath)}.`);
	}
	const module: unknown = await import(pathToFileURL(configPath).href);
	const plan = (module as { default?: unknown }).default;
	if (plan === undefined || typeof plan !== 'object') {
		fail(`${relative(AGENT_EVAL_ROOT, configPath)} must default-export a RunPlan object.`);
	}
	return plan as RunPlan;
}

// --- main ------------------------------------------------------------------

/**
 * Ctrl-C stops the plan between batches rather than killing this process.
 *
 * The signal reaches the whole process group, so the running batch dies either
 * way and its in-flight sandboxes are lost — but the batches already collected
 * still get their report, which is the entire point of collecting in batches.
 * A second Ctrl-C gives up on that and exits.
 */
let interrupted = false;

function watchForInterrupt(): void {
	process.on('SIGINT', () => {
		if (interrupted) {
			console.error('\nrun-plan: interrupted again — exiting without a report.');
			process.exit(130);
		}
		interrupted = true;
		console.error('\nrun-plan: interrupted — finishing the current batch, then reporting.');
	});
}

async function main(): Promise<void> {
	const flags = selectionFlags(process.env);
	const argv = flags
		.parser(
			process.argv.slice(2),
			{ scriptName: 'eval:plan', usage: 'Usage: pnpm eval:plan --config <path> [--dry]' },
			{
				config: flags.text('config', 'Plan config module (default plans/default.plan.ts)'),
				dry: flags.switch('dry', 'Print the batch plan and spend nothing'),
			},
		)
		.parseSync();

	const configArg = argv.config ?? DEFAULT_CONFIG;
	const configPath = isAbsolute(configArg) ? configArg : resolve(AGENT_EVAL_ROOT, configArg);
	const plan = await loadPlanConfig(configPath);

	const resolved = resolveRunPlan(plan, {
		experiments: knownExperiments(),
		evals: AGENTIC_REF_EVAL_REGISTRY,
	});

	console.log(`Config: ${relative(AGENT_EVAL_ROOT, configPath)}`);
	printPlan(resolved);

	if (argv.dry) {
		await printDryWork(resolved);
		return;
	}

	watchForInterrupt();

	const startedAt = new Date().toISOString();
	const outcomes: BatchOutcome[] = [];
	let stoppedAt: number | null = null;
	let stoppedBy: StopReason | null = null;

	for (const batch of resolved.batches) {
		console.log(`\n${describeBatch(batch, resolved.batches.length, resolved.plan.runs)}`);

		let outcome: BatchOutcome;
		try {
			outcome = await runBatch(batch, resolved);
		} catch (error) {
			outcome = {
				batch,
				cells: [],
				cached: [],
				invalidated: [],
				exitCode: null,
				durationMs: 0,
				signals: [],
				error: error instanceof Error ? error.message : String(error),
			};
		}
		outcomes.push(outcome);

		if (outcome.error !== undefined) {
			console.error(`  batch failed to run: ${outcome.error}`);
		}

		const stopping = outcome.signals.find(isPlanStoppingSignal);
		if (stopping !== undefined) {
			console.error(`\n  ${stopping.kind} exhaustion — stopping the plan: ${stopping.evidence}`);
			stoppedAt = batch.index;
			stoppedBy = 'resource';
			break;
		}

		if (interrupted) {
			stoppedAt = batch.index;
			stoppedBy = 'interrupt';
			break;
		}
	}

	const gaps = outcomes
		.flatMap((outcome) => outcome.cells)
		.filter((cell) => cell.collected < cell.expected);

	const sawMemoryPressure = outcomes.some((outcome) =>
		outcome.signals.some((signal) => signal.kind === 'memory'),
	);

	const report: PlanReport = {
		startedAt,
		completedAt: new Date().toISOString(),
		config: relative(AGENT_EVAL_ROOT, configPath),
		plan: { ...resolved.plan, since: resolved.plan.since?.toISOString() ?? null },
		batches: outcomes,
		gaps,
		stoppedAt,
		stoppedBy,
		recommendedParallelMax: sawMemoryPressure
			? narrowedParallelMax(resolved.plan.parallelMax, resolved.plan.runs)
			: null,
	};

	printReport(report, resolved.batches.length);
	console.log(`\nReport: ${relative(AGENT_EVAL_ROOT, writeReport(report))}`);

	// Non-zero on an incomplete sample: a gap, a batch that could not run, or a
	// plan cut short. Ordinary eval failures are data and do not count.
	const incomplete =
		gaps.length > 0 ||
		stoppedAt !== null ||
		outcomes.some((outcome) => outcome.error !== undefined);
	process.exit(incomplete ? 1 : 0);
}

main().catch((error: unknown) => {
	fail(error instanceof Error ? error.message : String(error));
});
