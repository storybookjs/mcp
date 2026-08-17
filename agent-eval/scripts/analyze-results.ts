#!/usr/bin/env node
// Offline metrics pass over stored eval runs.
//
// This script measures nothing itself. It discovers run directories and hands
// each run to the module its *experiment* names in `postAnalysis` — see
// lib/post-analysis/types.ts. Runs whose experiment names none are skipped.
//
// Keying on the experiment rather than the eval is what lets a family of arms —
// same task and setup, differing only in prompt or MCP endpoint — share one set
// of metrics, and lets one experiment span several evals.
//
// WHAT IS SUMMARIZED TOGETHER. A sample of one cell is spread over as many
// result directories as it took to collect: a plan tops a cell up until it has
// its full depth, and each invocation writes a directory of its own. Folding
// per directory would report ten runs as "10, then 2, then 1" and average each
// separately, so the tables are folded per *comparable set* instead — every
// stored run of one arm, one eval and one configuration, whatever timestamps
// they arrived under. Which runs those are is decided exactly as the plan
// runner decides what it can reuse; see lib/agentic-reference/comparability.ts.
//
// Runs collected under a configuration the experiment has since replaced stay a
// group of their own rather than being averaged into the current one.
//
// Each directory's own summary.json still gets rows scoped to that directory,
// under `postAnalysis`, next to the harness's own pass rate and mean duration —
// it describes the runs beside it, not the wider set they belong to.
//
// Every metric is a pure function of stored artifacts, so this can be re-run
// over historical results as often as a metric definition changes, without
// spending anything on model calls.
//
// A module measuring its runs against a pristine upstream tree also provides
// deltaToBaseline. For those, this script measures the pinned tree once per pin
// — through the module's own analyzeRun, in `baseline` mode — commits the result
// under baselines/, and hands both sets of numbers to deltaToBaseline.
//
// Every comparable set's rows are also collected into
// results/analysis-summary.json, so comparing arms is a single read rather than
// a walk over the tree.
//
// Analysis can still be expensive, so once a run has been analyzed, we record
// its output in post-analysis-meta.json. Later invocations reuse that cached
// output instead of recomputing it. Pass --recompute after changing a metric
// definition to force every matched run to be recomputed.
//
// Usage: pnpm results:analyze [--experiments <list>] [--evals <list>] [--since <ISO date>]
//                             [--latest] [--recompute] [--general] [--complexity] [--coverage]
//
//   --experiments <list>  only runs under results/<name>/, by name or glob
//   --evals <list>        only runs of these evals, by name, number (706) or glob
//   --since <ISO date>    only runs whose result directory is stamped on or after
//   --latest              only the newest result directory per experiment
//   --recompute           recompute analysis, and rebuild committed baselines,
//                         even where a cached result exists (alias: --force)
//   --general             print the per-run vitals and grouped summary tables
//   --complexity          print the complexity tables
//   --coverage            print the design-system coverage tables
//
// Selection follows the shared grammar in lib/agentic-reference/selection.ts:
// --cases and --flows are aliases, singular and plural spellings are the same
// flag, lists take commas or repetition, and --flag=value works as well as
// --flag value. Every flag also falls back to AGENTIC_REF_<FLAG>, so one
// exported selection narrows a run and the analysis that follows it alike.
//
// Fallbacks key off the canonical flag name, so --recompute reads
// AGENTIC_REF_RECOMPUTE; its --force spelling stays command-line only, since an
// AGENTIC_REF_FORCE exported to re-run a case should not go on to rebuild every
// committed baseline here.
//
// The three table flags select what is *printed*; everything is measured and
// written either way. Passing any of them prints exactly that set; passing none
// falls back to DEFAULT_TABLES below.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readRunOutcome } from '#lib/agentic-reference/collected-runs';
import {
	groupComparableRuns,
	isCurrentSample,
	parseResultTimestamp,
	readStoredFingerprint,
} from '#lib/agentic-reference/comparability';
import { typecheckExternalRepo } from '#lib/agentic-reference/external-repo';
import { loadOrBuildBaselineAnalysis } from '#lib/post-analysis/baseline';
import { postAnalysisFrom } from '#lib/post-analysis/hooks';
import { mergeIntoEvalSummary } from '#lib/post-analysis/summary';
import { isRecord } from '#lib/utils/type';
import { readJson } from '#lib/utils/files';
import { matchesAnySelector, selectionFlags } from '#lib/agentic-reference/selection';

import type { ComparableGroup } from '#lib/agentic-reference/comparability';
import type {
	Analysis,
	PostAnalysis,
	RunContext,
	SummarizeOptions,
} from '#lib/post-analysis/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const EVALS_DIR = join(ROOT, 'evals');

// --- options ---
const TABLE_SECTIONS = ['general', 'complexity', 'coverage'] as const;
type TableSection = (typeof TABLE_SECTIONS)[number];

// What prints when no table flag is passed. Coverage alone for now: it is the
// number the agentic-reference round is actually reading, and the other two
// families push it off the bottom of a terminal.
const DEFAULT_TABLES: TableSection[] = ['coverage'];

interface PostAnalysisOptions {
	experiments: string[];
	evals: string[];
	since: string | null;
	latest: boolean;
	recompute: boolean;
	tables: SummarizeOptions;
}

// Same grammar as the runner (lib/agentic-reference/selection.ts): canonical
// experiment/eval wording, case/flow accepted as aliases, singular and plural
// interchangeable, lists by comma or repetition, and each flag falling back to
// AGENTIC_REF_<FLAG>.
function parseOptions(argv: string[]): PostAnalysisOptions {
	const flags = selectionFlags(process.env);
	const parsed = flags
		.parser(
			argv,
			{ scriptName: 'results:analyze', usage: 'Usage: pnpm results:analyze [flags]' },
			{
				experiments: flags.experiments,
				evals: flags.evals,
				since: flags.text('since', 'Only runs stamped on or after this ISO date'),
				latest: flags.switch('latest', 'Only the newest result directory per experiment'),
				recompute: {
					...flags.switch(
						'recompute',
						'Recompute analysis and baselines even where a cached result exists',
					),
					alias: ['force'],
				},
				general: flags.switch('general', 'Print the per-run vitals and grouped summary tables'),
				complexity: flags.switch('complexity', 'Print the complexity tables'),
				coverage: flags.switch('coverage', 'Print the design-system coverage tables'),
			},
		)
		.parseSync();

	const sections = TABLE_SECTIONS.filter((section) => parsed[section] === true);
	// Naming any section selects exactly that set, so `--complexity` means "just
	// the complexity tables" rather than "the default plus complexity" — no
	// --no-<section> negation needed to get back to one family.
	const chosen = sections.length === 0 ? DEFAULT_TABLES : sections;

	return {
		experiments: parsed.experiments,
		evals: parsed.evals,
		since: parsed.since ?? null,
		latest: parsed.latest === true,
		recompute: parsed.recompute === true,
		tables: {
			general: chosen.includes('general'),
			complexity: chosen.includes('complexity'),
			coverage: chosen.includes('coverage'),
		},
	};
}

// --- discovery ---
// Layout: results/<experiment>/<model>/<timestamp>/<eval>/run-N/project
interface Run {
	runDir: string;
	projectDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
	/**
	 * Whether the run left a project tree behind. A run stopped by billing, a
	 * timeout or an unreachable endpoint leaves a directory with nothing in it to
	 * measure; those are carried this far anyway so that the selection narrows
	 * them like everything else, and are then reported rather than passed over in
	 * silence — they are the difference between the sample a plan believes it
	 * collected and the one these tables report. `pnpm results:prune` clears them.
	 */
	collected: boolean;
}

/** Every run directory under `dir`, collected or not. */
function findRuns(dir: string): Run[] {
	if (!existsSync(dir)) return [];
	const runs: Run[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name)) {
				walk(path);
				continue;
			}
			const parts = path.slice(RESULTS_DIR.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0]!,
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3)!,
				evalName: parts.at(-2)!,
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
				collected: readRunOutcome(path).collected,
			});
		}
	};
	walk(dir);
	return runs;
}

function selectRuns(runs: Run[], options: PostAnalysisOptions): Run[] {
	let selected = runs;
	selected = selected.filter(
		(run) =>
			matchesAnySelector(run.experiment, options.experiments) &&
			matchesAnySelector(run.evalName, options.evals),
	);
	if (options.since) {
		const since = new Date(options.since);
		if (Number.isNaN(since.getTime())) {
			throw new Error(`--since must be a parseable date; received "${options.since}"`);
		}
		// A directory whose name is not a timestamp cannot be vouched for, and the
		// point of a cutoff is to trust what stays in — so it stays out.
		selected = selected.filter((run) => {
			const at = parseResultTimestamp(run.timestamp);
			return at !== null && at >= since;
		});
	}
	if (options.latest) {
		const newest = new Map<string, string>();
		for (const run of selected) {
			const current = newest.get(run.experiment);
			if (current === undefined || run.timestamp > current)
				newest.set(run.experiment, run.timestamp);
		}
		selected = selected.filter((run) => run.timestamp === newest.get(run.experiment));
	}
	return selected;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// --- post-analysis loading ---
// Which module analyses a run is the experiment's call, not the eval's. The
// module comes across as a live object, so arms that share one share it by
// reference — which is exactly what groups their runs into a single summary.
const byExperiment = new Map<string, PostAnalysis | null>();

async function loadPostAnalysis(
	experiment: string,
	failures: string[],
): Promise<PostAnalysis | null> {
	const cached = byExperiment.get(experiment);
	if (cached !== undefined) return cached;

	// Agentic-reference arms are run from .agentic-ref/, so their generated
	// definitions live under .agentic-ref/experiments/ rather than experiments/.
	const definition = [
		join(ROOT, 'experiments', `${experiment}.ts`),
		join(ROOT, '.agentic-ref', 'experiments', `${experiment}.ts`),
	].find(existsSync);
	// Results outlive experiment definitions: a renamed or deleted arm leaves its
	// runs on disk, and those are skipped rather than fatal.
	let postAnalysis: PostAnalysis | null = null;
	if (definition) {
		try {
			postAnalysis = postAnalysisFrom(await import(pathToFileURL(definition).href), experiment);
		} catch (error) {
			// A definition that will not import, or names a malformed module, must
			// not cost every other arm its analysis. Reported once: the outcome is
			// cached below, so the remaining runs of this arm skip quietly.
			failures.push(`experiments/${experiment}.ts: ${messageOf(error)}`);
		}
	}

	byExperiment.set(experiment, postAnalysis);
	return postAnalysis;
}

// --- post-analysis cache ---
// One entry per run, stored next to other artifacts; --recompute ignores it.
const CACHE_FILENAME = 'post-analysis-meta.json';

function readCacheEntry(
	runDir: string,
): { analyzedAt: string; output: Record<string, unknown> | null } | null {
	return readJson(join(runDir, CACHE_FILENAME));
}

function writeCacheEntry(runDir: string, output: Record<string, unknown> | null) {
	console.log(`Writing ${CACHE_FILENAME} for ${runDir}`);
	writeFileSync(
		join(runDir, CACHE_FILENAME),
		JSON.stringify({ analyzedAt: new Date().toISOString(), output }, null, 2) + '\n',
	);
}

// --- per-run analysis ---
// The pin the run itself recorded, not the fixture's pin as it stands today:
// reading today's would retroactively change every historical delta the moment
// the fixture moves.
function pinOf(result: unknown) {
	const analysis = isRecord(result) && isRecord(result.analysis) ? result.analysis : {};
	try {
		return typecheckExternalRepo(analysis.externalRepo);
	} catch {
		return null;
	}
}

async function analyzeOneRun(
	run: Run,
	postAnalysis: PostAnalysis,
	options: PostAnalysisOptions,
): Promise<Analysis | null> {
	const transcript = readJson<unknown>(join(run.runDir, 'transcript.json'));
	if (!transcript) {
		throw new Error('transcript.json missing or unreadable');
	}

	const result = readJson(join(run.runDir, 'result.json'));
	const context: RunContext = {
		mode: 'run',
		runDir: run.runDir,
		projectDir: run.projectDir,
		fixtureDir: join(EVALS_DIR, run.evalName),
		experiment: run.experiment,
		model: run.model,
		timestamp: run.timestamp,
		evalName: run.evalName,
		run: run.run,
		result,
		transcript,
		pin: pinOf(result),
	};

	const runAnalysis = await postAnalysis.analyzeRun(context);
	if (runAnalysis === null || postAnalysis.deltaToBaseline === undefined) {
		return runAnalysis;
	}

	const { pin } = context;
	if (pin === null) {
		throw new Error(
			'run recorded no usable evals.externalRepo pin, so there is no baseline to compare it against',
		);
	}

	const baseline = await loadOrBuildBaselineAnalysis({
		evalName: run.evalName,
		fixtureDir: context.fixtureDir,
		pin,
		postAnalysis,
		recompute: options.recompute,
	});

	return {
		...runAnalysis,
		deltaToBaseline: await postAnalysis.deltaToBaseline({
			...context,
			pin,
			runAnalysis,
			baselineDir: baseline.dir,
			baselineAnalysis: baseline.analysis,
		}),
	};
}

// --- entry point ---
interface SuccessfulAnalysis extends Record<string, unknown> {
	__run: Run;
	__postAnalysis: PostAnalysis;
}
// Internal routing state, stripped before anything sees a record.
function strip(row: SuccessfulAnalysis): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => key !== '__run' && key !== '__postAnalysis'),
	);
}

/**
 * Each result directory's fingerprint, and whether it is one the experiment's
 * configuration still produces — the two facts that decide what can be folded
 * with what.
 */
async function judgeSamples(
	byEvalDir: ReadonlyMap<string, SuccessfulAnalysis[]>,
): Promise<Map<string, { fingerprint: string | null; current: boolean }>> {
	const judged = new Map<string, { fingerprint: string | null; current: boolean }>();
	for (const [evalDir, analyses] of byEvalDir) {
		const { experiment, evalName } = analyses[0]!.__run;
		const fingerprint = readStoredFingerprint(evalDir);
		judged.set(evalDir, {
			fingerprint,
			current: await isCurrentSample({
				experiment,
				evalName,
				fingerprint,
				// Runs the analysis could read, which is a lower bound on the sample
				// size the collection asked for — enough, since what is tried anyway
				// covers every size a plan on this hardware could have requested.
				runsOnDisk: analyses.length,
			}),
		});
	}
	return judged;
}

/** A comparable set's heading: which arm, which eval, which generation. */
function heading(group: ComparableGroup<SuccessfulAnalysis>): string {
	const arm = [group.experiment, group.model].filter((part) => part !== '').join('/');
	const cell = `${arm} · ${group.evalName}`;
	// Named by the fingerprint they share, which is all that distinguishes two
	// replaced generations of one cell from each other.
	return group.current
		? cell
		: `${cell}  (superseded config ${group.fingerprint?.slice(0, 8) ?? 'unknown'})`;
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	const selected = selectRuns(findRuns(RESULTS_DIR), options);
	const runs = selected.filter((run) => run.collected);
	const incomplete = selected.length - runs.length;

	const successfulAnalyses: SuccessfulAnalysis[] = [];
	const failedAnalyses: string[] = [];
	let withoutHook = 0;
	let reused = 0;

	for (const run of runs) {
		// The experiment names the module that analyses its runs; if it names
		// none, this run is not ours to measure.
		const postAnalysis = await loadPostAnalysis(run.experiment, failedAnalyses);
		if (postAnalysis === null) {
			withoutHook += 1;
			continue;
		}

		// Fetch cached post analysis output unless --recompute was passed.
		const cached = options.recompute ? null : readCacheEntry(run.runDir);
		if (cached) {
			reused += 1;
			if (cached.output) {
				successfulAnalyses.push({
					...cached.output,
					__run: run,
					__postAnalysis: postAnalysis,
				});
			}
			continue;
		}

		try {
			const analysisOutput = await analyzeOneRun(run, postAnalysis, options);
			// The hooks compute; the runner owns where the numbers land.
			if (analysisOutput) {
				writeFileSync(
					join(run.runDir, 'analysis.json'),
					JSON.stringify(analysisOutput, null, 2) + '\n',
				);
			}
			writeCacheEntry(run.runDir, analysisOutput ?? null);
			if (analysisOutput) {
				successfulAnalyses.push({ ...analysisOutput, __run: run, __postAnalysis: postAnalysis });
			}
		} catch (error) {
			// One broken run must not cost us the others.
			failedAnalyses.push(`${run.evalName} run-${run.run}: ${messageOf(error)}`);
		}
	}

	if (incomplete > 0) {
		console.log(
			`Skipped ${incomplete} run director${incomplete === 1 ? 'y' : 'ies'} holding no project ` +
				'tree: those runs stopped on billing, a timeout or another infra failure. ' +
				'Run `pnpm results:prune` to see and clear them.',
		);
	}
	if (withoutHook > 0) {
		console.log(
			`Skipped ${withoutHook} ${withoutHook === 1 ? 'run' : 'runs'} whose experiment carries no postAnalysis.`,
		);
	}
	if (reused > 0) {
		console.log(`Reused cached analysis for ${reused} run(s); pass --recompute to recompute.`);
	}
	for (const message of failedAnalyses) console.error(`Analysis failed for ${message}`);

	if (successfulAnalyses.length === 0) {
		console.log('No analysable runs found under results/.');
		return;
	}

	successfulAnalyses.sort(
		(a, b) =>
			String(a.__run.experiment).localeCompare(String(b.__run.experiment)) ||
			String(a.__run.timestamp).localeCompare(String(b.__run.timestamp)) ||
			a.__run.run - b.__run.run,
	);

	// summary.json belongs to the directory it sits in, so it is folded from that
	// directory's runs alone — quietly, since what gets printed is the wider set
	// those runs belong to.
	const byEvalDir = new Map<string, SuccessfulAnalysis[]>();
	for (const row of successfulAnalyses) {
		const evalDir = dirname(row.__run.runDir);
		const list = byEvalDir.get(evalDir) ?? [];
		list.push(row);
		byEvalDir.set(evalDir, list);
	}
	for (const [evalDir, analyses] of byEvalDir) {
		const rows = analyses[0]!.__postAnalysis.summarize(analyses.map(strip), {
			...options.tables,
			quiet: true,
		});
		mergeIntoEvalSummary(evalDir, rows);
	}

	const comparability = await judgeSamples(byEvalDir);
	const groups = groupComparableRuns(successfulAnalyses, (row) => ({
		experiment: row.__run.experiment,
		model: row.__run.model,
		evalName: row.__run.evalName,
		...comparability.get(dirname(row.__run.runDir))!,
	}));

	const summary: Analysis[] = [];
	for (const group of groups) {
		console.log(`\n===  ${heading(group)}  ===\n`);
		// Every run of a comparable set is one arm's, so they share one module.
		const rows = group.members[0]!.__postAnalysis.summarize(
			group.members.map(strip),
			options.tables,
		);
		summary.push(...rows);
	}

	// The console view is for reading now; this is what gets loaded later. Every
	// matched run in one file, so comparing arms is a single read.
	writeFileSync(
		join(RESULTS_DIR, 'analysis-summary.json'),
		JSON.stringify({ runs: successfulAnalyses.map(strip), summary }, null, 2) + '\n',
	);
}

main().catch((error) => {
	console.error(messageOf(error));
	process.exit(1);
});
