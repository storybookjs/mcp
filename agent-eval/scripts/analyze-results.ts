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
// summarize is scoped to one eval directory — the folder holding that eval's
// run-* dirs — and its rows are written back into that folder's summary.json
// under `postAnalysis`, next to the harness's own pass rate and mean duration.
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
// Every group's rows are also collected into results/analysis-summary.json, so
// comparing arms is a single read rather than a walk over the tree.
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
//   --misuse             print the design-system misuse tables (see judge:ds-misuse)
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
// The table flags select what is *printed*; everything is measured and
// written either way. Passing any of them prints exactly that set; passing none
// falls back to DEFAULT_TABLES below.
import { writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pinOfResult } from '#lib/agentic-reference/external-repo';
import { readUsableMisuseReports } from '#lib/agentic-reference/metrics/ds-misuse/index';
import { loadOrBuildBaselineAnalysis } from '#lib/post-analysis/baseline';
import {
	findRuns,
	runSelectionOptions,
	selectRuns,
	toRunSelection,
	type Run,
	type RunSelection,
} from '#lib/post-analysis/discovery';
import { createPostAnalysisLoader } from '#lib/post-analysis/hooks';
import { mergeIntoEvalSummary } from '#lib/post-analysis/summary';
import { messageOf } from '#lib/utils/error';
import { readJson } from '#lib/utils/files';
import { selectionFlags } from '#lib/agentic-reference/selection';

import type { DsMisuseReport } from '#lib/agentic-reference/metrics/ds-misuse/types';
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
const TABLE_SECTIONS = ['general', 'complexity', 'coverage', 'misuse'] as const;
type TableSection = (typeof TABLE_SECTIONS)[number];

// What prints when no table flag is passed. Coverage alone for now: it is the
// number the agentic-reference round is actually reading, and the other two
// families push it off the bottom of a terminal.
const DEFAULT_TABLES: TableSection[] = ['coverage'];

interface PostAnalysisOptions extends RunSelection {
	recompute: boolean;
	tables: SummarizeOptions;
}

// Same grammar as the runner (lib/agentic-reference/selection.ts): canonical
// experiment/eval wording, case/flow accepted as aliases, singular and plural
// interchangeable, lists by comma or repetition, and each flag falling back to
// AGENTIC_REF_<FLAG>. The selection flags themselves come from discovery.ts, so
// this CLI and judge:ds-misuse cannot drift on what a selection means.
function parseOptions(argv: string[]): PostAnalysisOptions {
	const flags = selectionFlags(process.env);
	const parsed = flags
		.parser(
			argv,
			{ scriptName: 'results:analyze', usage: 'Usage: pnpm results:analyze [flags]' },
			{
				...runSelectionOptions(flags),
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
				misuse: flags.switch('misuse', 'Print the design-system misuse tables'),
			},
		)
		.parseSync();

	const sections = TABLE_SECTIONS.filter((section) => parsed[section] === true);
	// Naming any section selects exactly that set, so `--complexity` means "just
	// the complexity tables" rather than "the default plus complexity" — no
	// --no-<section> negation needed to get back to one family.
	const chosen = sections.length === 0 ? DEFAULT_TABLES : sections;

	return {
		...toRunSelection(parsed),
		recompute: parsed.recompute === true,
		tables: {
			general: chosen.includes('general'),
			complexity: chosen.includes('complexity'),
			coverage: chosen.includes('coverage'),
			misuse: chosen.includes('misuse'),
		},
	};
}

/**
 * The judge invocation covering exactly the runs this pass looked at.
 *
 * Every selection flag is carried, not just the ones that are easy to spell: the
 * judge costs a model call per run, so a command that drops --since or --evals
 * sends the operator off to judge runs they had deliberately excluded.
 */
function rejudgeCommand(selection: RunSelection): string {
	const list = (flag: string, values: string[]) =>
		values.length === 0 ? '' : ` --${flag}=${values.join(',')}`;
	return (
		'pnpm judge:ds-misuse' +
		list('experiments', selection.experiments) +
		list('evals', selection.evals) +
		(selection.since === null ? '' : ` --since=${selection.since}`) +
		(selection.latest ? ' --latest' : '')
	);
}

// --- post-analysis loading ---
// Which module analyses a run is the experiment's call, not the eval's. Shared
// with judge-ds-misuse.ts, so the paid CLI skips exactly the runs this one does.
//
// Agentic-reference arms are run from .agentic-ref/, so their generated
// definitions live under .agentic-ref/experiments/ rather than experiments/.
const loadPostAnalysis = createPostAnalysisLoader([
	join(ROOT, 'experiments'),
	join(ROOT, '.agentic-ref', 'experiments'),
]);

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
		pin: pinOfResult(result),
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
/** Internal routing state, removed before anything sees a record. */
function strip(row: SuccessfulAnalysis): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => key !== '__run' && key !== '__postAnalysis'),
	);
}

/**
 * A row as the tables and analysis-summary.json see it.
 *
 * The artifact is merged here rather than into the cached analysis because the
 * judge runs *after* this script: folded in before the cache lookup it would
 * store a scoreless row that no later pass refreshes without --recompute.
 */
function withMisuse(
	row: SuccessfulAnalysis,
	reports: ReadonlyMap<string, DsMisuseReport | null>,
): Record<string, unknown> {
	const report = reports.get(row.__run.runDir) ?? null;
	return { ...strip(row), ...(report === null ? {} : { dsMisuse: report }) };
}

async function main() {
	const options = parseOptions(process.argv.slice(2));
	const runs = selectRuns(findRuns(RESULTS_DIR), options);

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

	// A silently absent metric is the failure mode worth shouting about, so this
	// fires whichever table families were selected. A stale artifact counts as
	// unjudged: it is left out of the tables below, so saying otherwise here
	// would point at a column that is not there. Re-judging needs no --recompute,
	// since the judge does not reuse a stale artifact either.
	const misuseReports = readUsableMisuseReports(
		successfulAnalyses.map((row) => ({
			runDir: row.__run.runDir,
			metricsVersion: row.__postAnalysis.metricsVersion,
		})),
	);
	const unjudged = misuseReports.absent + misuseReports.stale;
	if (unjudged > 0) {
		const bold = '\x1b[1;31m';
		const reset = '\x1b[0m';
		const breakdown =
			misuseReports.stale === 0
				? ''
				: ` (${misuseReports.stale} judged against a superseded standard, ` +
					`${misuseReports.absent} never judged)`;
		console.error(
			`\n${bold}No usable ds-misuse judgement for ${unjudged} of ` +
				`${successfulAnalyses.length} run(s)${breakdown}.${reset}\n` +
				`  Run: ${rejudgeCommand(options)}`,
		);
	}

	// Grouped by the directory holding the run-* dirs, i.e. one group per eval of
	// one experiment at one timestamp. That is the unit summary.json describes,
	// so summarize is scoped to it and every run in a group shares one module.
	const byEvalDir = new Map<string, SuccessfulAnalysis[]>();
	for (const row of successfulAnalyses) {
		const evalDir = dirname(row.__run.runDir);
		const list = byEvalDir.get(evalDir) ?? [];
		list.push(row);
		byEvalDir.set(evalDir, list);
	}

	const summary: Analysis[] = [];
	for (const [evalDir, analyses] of byEvalDir) {
		console.log(`\n===  ${relative(RESULTS_DIR, evalDir)}  ===\n`);
		const rows = analyses[0]!.__postAnalysis.summarize(
			analyses.map((row) => withMisuse(row, misuseReports.byRunDir)),
			options.tables,
		);
		mergeIntoEvalSummary(evalDir, rows);
		summary.push(...rows);
	}

	// The console view is for reading now; this is what gets loaded later. Every
	// matched run in one file, so comparing arms is a single read.
	writeFileSync(
		join(RESULTS_DIR, 'analysis-summary.json'),
		JSON.stringify(
			{
				runs: successfulAnalyses.map((row) => withMisuse(row, misuseReports.byRunDir)),
				summary,
			},
			null,
			2,
		) + '\n',
	);
}

main().catch((error) => {
	console.error(messageOf(error));
	process.exit(1);
});
