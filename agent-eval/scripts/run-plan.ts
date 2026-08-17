#!/usr/bin/env node
// The plan runner: collects a research sample on local hardware without ever
// putting more than `parallelMax` sandboxes on this machine at once, and
// without re-collecting a repetition it already has.
//
//   pnpm eval:plan --config plans/<name>.plan.ts [--dry]
//
//   --config <path>  the plan config (default AGENTIC_REF_CONFIG, then plans/default.plan.ts)
//   --dry            print what would be collected and spend nothing
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
// collection disappears. This script cuts the matrix into batches that fit,
// runs them strictly one after another through the existing eval:agentic-ref
// runner, and so caps the loss at a single batch.
//
// WHY IT SHELLS OUT rather than calling runExperiment directly: the runner
// script already generates the .agentic-ref work directory, links .env.local
// into it, validates the selection against the case registry, and lets the CLI
// do failure classification and housekeeping. Driving it as a child process
// keeps one code path for "run some evals" and gets process isolation for free
// — a batch that dies takes its own process down, not this one.
//
// WHAT IT COLLECTS. The plan counts the qualifying runs each cell already has
// and asks only for the difference, so a cell holding 6 of its 10 collects 4.
// A run qualifies when its stored fingerprint is the current one for that
// fixture and experiment config — at any sample size, since `runs` is hashed
// into the fingerprint and a top-up is otherwise unrecognisable — and when it
// was saved at or after the plan's cutoff. That judgement lives in
// lib/agentic-reference/comparability.ts, shared with the offline analyzer so
// that runs collected as one sample are also analysed as one. It takes the
// reuse decision away
// from the harness's own cache, which is all-or-nothing and cannot express a
// partial sample, so every invocation runs with --force.
//
// HOW A BATCH IS JUDGED. Not by exit code: `run-all` exits 1 whenever any eval
// has a 0% pass rate, which for a control arm is the measurement, not a fault.
// The verdict comes from disk instead — the run-* directories the batch wrote,
// against the number it asked for. A cell short of its request means the
// classifier deleted infra/timeout runs (or the batch died before saving);
// either way the report names the cell and prints the command that tops it up.
//
// Nothing is retried. A batch that fails is recorded and the plan moves on, so
// an unattended overnight run always ends with a complete account of what it
// did and did not collect.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AGENTIC_REF_CASES, AGENTIC_REF_EVAL_REGISTRY } from '../lib/agentic-reference/cases.ts';
import { countCollectedRuns } from '../lib/agentic-reference/collected-runs.ts';
import {
	acceptableFingerprints,
	parseResultTimestamp,
	readStoredFingerprint,
} from '../lib/agentic-reference/comparability.ts';
import { selectionFlags } from '../lib/agentic-reference/selection.ts';
import {
	type CellOutcome,
	type CellPlan,
	EXPERIMENT_NAME_PREFIX,
	type PlanBatch,
	type ResolvedRunPlan,
	type ResourceSignal,
	type RunPlan,
	type StoredSample,
	explainDeficit,
	isPlanStoppingSignal,
	narrowedParallelMax,
	planBatches,
	planCell,
	resolveRunPlan,
	scanResourceSignals,
	topUpCommand,
} from '../lib/agentic-reference/run-plan.ts';
import { generateAgenticRefWorkdir } from './generate-agentic-ref-experiments.ts';

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

// --- reading what is already on disk ---------------------------------------

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
 * Runs of one cell across a set of result directories, counting only those that
 * produced a project tree — a batch whose attempts all died on billing or a
 * timeout collected nothing, however many directories it left behind. See
 * lib/agentic-reference/collected-runs.ts.
 */
function countSavedRuns(experiment: string, evalName: string, dirs: readonly string[]): number {
	let total = 0;
	for (const dir of dirs) {
		total += countCollectedRuns(join(RESULTS_DIR, experiment, dir, evalName));
	}
	return total;
}

/** Every stored sample of one cell, whether or not it still counts. */
function storedSamples(experiment: string, evalName: string): StoredSample[] {
	const samples: StoredSample[] = [];
	for (const dir of resultDirs(experiment)) {
		const evalDir = join(RESULTS_DIR, experiment, dir, evalName);
		const runs = countCollectedRuns(evalDir);
		if (runs === 0) {
			continue;
		}
		samples.push({
			dir,
			at: parseResultTimestamp(basename(dir)),
			fingerprint: readStoredFingerprint(evalDir),
			runs,
		});
	}
	return samples;
}

// --- what every cell still needs -------------------------------------------

/** Works out what every cell of the plan still needs. */
async function planCells(resolved: ResolvedRunPlan): Promise<CellPlan[]> {
	const { runs, since, force } = resolved.plan;
	const planned: CellPlan[] = [];

	for (const cell of resolved.cells) {
		// Skipped under force: the answer is the full target either way, and
		// loading every stub to hash fixtures would be pure latency.
		const acceptable = force
			? new Set<string>()
			: await acceptableFingerprints(cell.experiment, cell.evalName, runs);
		planned.push(
			planCell(cell, force ? [] : storedSamples(cell.experiment, cell.evalName), {
				target: runs,
				acceptable,
				since,
				force,
			}),
		);
	}

	return planned;
}

// --- driving the runner ----------------------------------------------------

interface ChildResult {
	exitCode: number | null;
	output: string;
}

/**
 * Runs the agentic-ref runner as a child process.
 *
 * Output is streamed as it arrives *and* kept: the copy is what resource
 * signals are scanned out of. Piping costs the CLI's live dashboard (it only
 * renders on a TTY) and falls back to its line-by-line progress handler — the
 * better trade for a multi-hour run whose log is the artifact you keep.
 */
function runRunner(args: string[]): Promise<ChildResult> {
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
				sink.write(chunk);
			});
		};
		capture(child.stdout, process.stdout);
		capture(child.stderr, process.stderr);

		child.on('error', rejectPromise);
		child.on('close', (exitCode) => resolvePromise({ exitCode, output }));
	});
}

/**
 * --force on every invocation: this script has already decided what is missing,
 * and the harness's own cache would otherwise skip a cell whose fingerprint
 * happens to match — including one it has only a partial sample of.
 */
function runnerArgs(batch: PlanBatch, resolved: ResolvedRunPlan): string[] {
	return [
		'--experiments',
		batch.experiments.join(','),
		'--evals',
		batch.evalName,
		'--runs',
		String(batch.runs),
		'--force',
		...(resolved.plan.ackFailures ? ['--ack-failures'] : []),
	];
}

async function runBatch(batch: PlanBatch, resolved: ResolvedRunPlan): Promise<BatchOutcome> {
	const started = Date.now();
	const before = new Map(batch.experiments.map((name) => [name, new Set(resultDirs(name))]));

	const run = await runRunner(runnerArgs(batch, resolved));

	const cells: CellOutcome[] = batch.experiments.map((experiment) => {
		const added = resultDirs(experiment).filter((name) => !before.get(experiment)!.has(name));
		return {
			experiment,
			evalName: batch.evalName,
			expected: batch.runs,
			collected: countSavedRuns(experiment, batch.evalName, added),
		};
	});

	return {
		batch,
		cells,
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

function describeBatch(batch: PlanBatch, total: number): string {
	return (
		`[${batch.index}/${total}] ${batch.evalName} × ${batch.experiments.join(', ')} ` +
		`(${batch.experiments.length} cell(s) × ${batch.runs} runs = ${batch.parallel} sandboxes)`
	);
}

function printPlan(resolved: ResolvedRunPlan, cells: CellPlan[], batches: PlanBatch[]): void {
	const { plan } = resolved;
	const outstanding = cells.filter((cell) => cell.deficit > 0);
	const toCollect = outstanding.reduce((total, cell) => total + cell.deficit, 0);
	const alreadyHave = cells.reduce((total, cell) => total + cell.qualifying, 0);

	console.log(
		`Plan: ${resolved.experiments.length} experiment(s) × ${resolved.evals.length} eval(s) ` +
			`× ${plan.runs} run(s) = ${cells.length} cells, ${cells.length * plan.runs} runs.`,
	);
	if (plan.force) {
		console.log('force: collecting the full target for every cell, ignoring what is on disk.');
	} else if (plan.since !== null) {
		console.log(`since ${plan.since.toISOString()}: earlier runs do not count towards a target.`);
	}
	if (plan.ackFailures) {
		console.log('ackFailures: infra and timeout runs are kept as final results.');
	}

	console.log('');
	for (const evalName of resolved.evals) {
		console.log(`  ${evalName}`);
		for (const cell of cells.filter((candidate) => candidate.evalName === evalName)) {
			const state =
				cell.deficit === 0
					? `complete (${cell.qualifying}/${cell.target})`
					: `collect ${cell.deficit} — ${explainDeficit(cell)}`;
			console.log(`    ${cell.experiment.padEnd(42)} ${state}`);
		}
	}

	console.log(
		`\n  ${alreadyHave} run(s) already qualify; ${toCollect} to collect across ` +
			`${outstanding.length} cell(s), in ${batches.length} batch(es) of at most ` +
			`${plan.parallelMax} sandboxes.\n`,
	);
	for (const batch of batches) {
		console.log(`  ${describeBatch(batch, batches.length)}`);
	}
	console.log('');
}

type StopReason = 'resource' | 'interrupt';

interface PlanReport {
	startedAt: string;
	completedAt: string;
	config: string;
	plan: Omit<ResolvedRunPlan['plan'], 'since'> & { since: string | null };
	/** What every cell already had and what the plan asked for. */
	cells: CellPlan[];
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
		const collected = collectedRuns(outcome);
		const expected = expectedRuns(outcome);
		const state = collected === expected ? 'ok' : `GAP ${expected - collected} run(s)`;
		console.log(
			`  ${label}  ${collected}/${expected} runs  ${formatDuration(outcome.durationMs)}  ${state}`,
		);
	}

	const totalCollected = batches.reduce((sum, outcome) => sum + collectedRuns(outcome), 0);
	const totalExpected = batches.reduce((sum, outcome) => sum + expectedRuns(outcome), 0);
	const reused = report.cells.reduce((sum, cell) => sum + cell.qualifying, 0);
	console.log(
		`\n  Collected ${totalCollected}/${totalExpected} requested runs, on top of ${reused} ` +
			`that already qualified.`,
	);

	if (gaps.length > 0) {
		console.log(`\n  Gaps (${gaps.length} cell(s) short of what was requested):`);
		for (const cell of gaps) {
			console.log(
				`    ${cell.evalName} × ${cell.experiment}  ${cell.collected}/${cell.expected} runs`,
			);
			console.log(`      ${topUpCommand(cell)}`);
		}
		console.log(
			'\n  A shortfall means the classifier removed infra or timeout runs, or the batch died\n' +
				'  before saving. Re-running the plan collects the difference on its own; the\n' +
				'  commands above do it one cell at a time.',
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
				'  Re-run the same config to continue — collected runs count towards their targets.',
		);
	}

	console.log('─'.repeat(72));
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
				dry: flags.switch('dry', 'Print what would be collected and spend nothing'),
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

	// The stubs are what fingerprints are computed from, so they have to exist
	// before any counting — the runner would otherwise be the first to build them.
	generateAgenticRefWorkdir();

	const cells = await planCells(resolved);
	const batches = planBatches(cells, resolved.evals, resolved.plan.parallelMax);

	console.log(`Config: ${relative(AGENT_EVAL_ROOT, configPath)}`);
	printPlan(resolved, cells, batches);

	if (argv.dry) {
		return;
	}
	if (batches.length === 0) {
		console.log('Nothing to collect: every cell already has its full sample.');
		return;
	}

	watchForInterrupt();

	const startedAt = new Date().toISOString();
	const outcomes: BatchOutcome[] = [];
	let stoppedAt: number | null = null;
	let stoppedBy: StopReason | null = null;

	for (const batch of batches) {
		console.log(`\n${describeBatch(batch, batches.length)}`);

		let outcome: BatchOutcome;
		try {
			outcome = await runBatch(batch, resolved);
		} catch (error) {
			outcome = {
				batch,
				cells: [],
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
		cells,
		batches: outcomes,
		gaps,
		stoppedAt,
		stoppedBy,
		recommendedParallelMax: sawMemoryPressure
			? narrowedParallelMax(resolved.plan.parallelMax, resolved.plan.runs)
			: null,
	};

	printReport(report, batches.length);
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
