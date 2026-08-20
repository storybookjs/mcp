#!/usr/bin/env node
// LLM-judged design-system misuse over stored eval runs.
//
// Unlike scripts/analyze-results.ts, this is NOT free: it makes one model call
// per run. That is the whole reason it is a separate command — analyze-results
// documents that every metric it computes is a pure function of stored
// artifacts, re-runnable as often as a definition changes without spending
// anything, and calling a paid API from it would end that guarantee.
//
// Each run's judgement is cached in its own directory as ds-misuse.json and
// reused until the guidelines pin or the metrics version moves.
//
// The package script runs this under `node --env-file-if-exists=.env.local`.
// Every other entry point into this suite goes through the agent-eval binary,
// which loads .env.local itself; a plain `node scripts/...` is the odd one out,
// and without the flag the ANTHROPIC_API_KEY abort would name a fix — "add it to
// .env.local" — that does not actually work. The -if-exists form is deliberate:
// plain --env-file is fatal when the file is absent, which would break every
// invocation by anyone who exports the key instead.
//
// --dry settles everything that can be settled locally (pin, DS packages, cache
// freshness, node census) and prints which runs it would judge, reuse or skip.
//
// Usage: pnpm judge:ds-misuse [flags]. Run with --help for the flag list.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENTIC_REF_EVAL_REGISTRY, knownExperimentNames } from '#lib/agentic-reference/cases';
import {
	type ExternalRepoPin,
	prepareRef,
	typecheckExternalRepo,
} from '#lib/agentic-reference/external-repo';
import { loadPlanConfig, resolvePlanPath } from '#lib/agentic-reference/plan-config';
import { resolveRunPlan } from '#lib/agentic-reference/run-plan';
import { dsPackagesForPin } from '#lib/agentic-reference/metrics/coverage';
import { dsDocsRefLabel } from '#lib/agentic-reference/metrics/ds-misuse/ds-docs';
import {
	isStale,
	judgeRun,
	readMisuseReport,
	writeMisuseReport,
} from '#lib/agentic-reference/metrics/ds-misuse/index';
import { assertApiKey } from '#lib/agentic-reference/metrics/ds-misuse/judge';
import { postAnalysis } from '#lib/agentic-reference/post-analysis';
import { readNodeSidecar } from '#lib/post-analysis/baseline';
import { findRuns, selectRuns, type Run, type RunSelection } from '#lib/post-analysis/discovery';
import { selectionFlags } from '#lib/agentic-reference/selection';
import { readJson } from '#lib/utils/files';
import { isRecord } from '#lib/utils/type';

import type { JudgeUsage } from '#lib/agentic-reference/metrics/ds-misuse/judge';
import type { NodeRecord } from '#lib/agentic-reference/metrics/ds-coverage/types';

// claude-opus-4-8 list prices per million tokens. The judge caches the doc
// corpus with a 1h TTL, so the write rate is the 1h one. A moved judge model
// means these need moving with it.
const USD_PER_MTOK = { input: 5, cacheRead: 0.5, cacheWrite: 10, output: 25 };

function usdOf(usage: JudgeUsage): number {
	return (
		(usage.inputTokens * USD_PER_MTOK.input +
			usage.cacheReadTokens * USD_PER_MTOK.cacheRead +
			usage.cacheWriteTokens * USD_PER_MTOK.cacheWrite +
			usage.outputTokens * USD_PER_MTOK.output) /
		1_000_000
	);
}

function addUsage(total: JudgeUsage, usage: JudgeUsage): void {
	total.inputTokens += usage.inputTokens;
	total.cacheReadTokens += usage.cacheReadTokens;
	total.cacheWriteTokens += usage.cacheWriteTokens;
	total.outputTokens += usage.outputTokens;
}

function tokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const BASELINES_DIR = join(ROOT, 'baselines');
const REF_CACHE_DIR = join(ROOT, '.eval-cache/refs');

// Selection is the shared agentic-reference grammar, not a private one: this
// command spends money per run, and `--experiments`/`--evals` is how a sweep is
// narrowed to the arm under review. A second dialect here would mean the flags
// that scope a paid run read differently from the ones that scope the free
// analysis pass over the same directories.
interface Options extends RunSelection {
	plan: string | undefined;
	recompute: boolean;
	dry: boolean;
}

function parseOptions(argv: string[]): Options {
	const flags = selectionFlags(process.env);
	const parsed = flags
		.parser(
			argv,
			{
				scriptName: 'judge:ds-misuse',
				usage: 'Usage: pnpm judge:ds-misuse [flags]',
			},
			{
				experiments: flags.experiments,
				evals: flags.evals,
				plan: flags.text('plan', "Judge a collection plan's cells (plans/<name>.plan.ts)"),
				since: flags.text('since', 'Only runs stamped on or after this ISO date'),
				latest: flags.switch('latest', 'Only the newest result directory per experiment'),
				dry: flags.switch('dry', 'Print the plan and spend nothing'),
				recompute: {
					...flags.switch('recompute', 'Re-judge runs that already carry a ds-misuse.json'),
					alias: ['force'],
				},
			},
		)
		.parseSync();

	return {
		experiments: parsed.experiments,
		evals: parsed.evals,
		plan: parsed.plan,
		since: parsed.since ?? null,
		latest: parsed.latest,
		dry: parsed.dry,
		recompute: parsed.recompute,
	};
}

/**
 * Scope the selection to one collection plan's cells, exactly as
 * results:compare reads the same flag — so the runs a plan's comparison
 * tables stand on are the runs this command judges, and a bundle never mixes
 * judged and unjudged cells because the two commands were scoped by hand
 * twice. The plan's own `since` applies unless --since narrows further.
 */
async function applyPlanScope(options: Options): Promise<Options> {
	if (options.plan === undefined) {
		return options;
	}
	if (options.experiments.length > 0 || options.evals.length > 0) {
		throw new Error(
			'--plan already names the cases and workflows; drop --experiments/--evals ' +
				'(or unset AGENTIC_REF_EXPERIMENTS/AGENTIC_REF_EVALS).',
		);
	}
	const resolved = resolveRunPlan(await loadPlanConfig(resolvePlanPath(options.plan)), {
		experiments: knownExperimentNames(),
		evals: AGENTIC_REF_EVAL_REGISTRY,
	});
	return {
		...options,
		experiments: [...resolved.experiments],
		evals: [...resolved.evals],
		since: options.since ?? resolved.plan.since?.toISOString() ?? null,
	};
}

/** The pin the run itself recorded — never today's fixture pin. */
function pinOf(runDir: string) {
	const result = readJson(join(runDir, 'result.json'));
	const analysis = isRecord(result) && isRecord(result.analysis) ? result.analysis : {};
	try {
		return typecheckExternalRepo(analysis.externalRepo);
	} catch {
		return null;
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function labelOf(run: Run): string {
	return `${run.experiment}/${run.timestamp}/${run.evalName}/run-${run.run}`;
}

type Plan =
	| { action: 'reused' | 'skipped' }
	| {
			action: 'judge';
			pin: ExternalRepoPin;
			fixtureRef: string;
			dsPackages: string[];
			baselineNodes: NodeRecord[];
	  };

/**
 * Everything a run needs before anything is spent on it, and whether it has it.
 *
 * Kept separate from the call it precedes so --dry can reach the same verdicts
 * for free: the checks below are the ones that decide whether a run is worth
 * paying for, so a plan that skipped any of them would not be the plan.
 */
function planRun(run: Run, options: Options): Plan {
	const label = labelOf(run);

	const pin = pinOf(run.runDir);
	if (pin === null) {
		console.error(`${label}: recorded no usable evals.externalRepo pin, so it has no baseline.`);
		return { action: 'skipped' };
	}
	const fixtureRef = `${pin.repo}@${pin.ref}`;

	const dsPackages = dsPackagesForPin(pin);
	if (dsPackages === null) {
		console.error(
			`${label}: ${fixtureRef} declares no DS packages. ` +
				'Add it to DS_PACKAGES_BY_PIN in lib/agentic-reference/metrics/coverage.ts.',
		);
		return { action: 'skipped' };
	}

	const existing = options.recompute ? null : readMisuseReport(run.runDir);
	if (
		existing &&
		!isStale(existing, {
			dsGuidelinesRef: dsDocsRefLabel(),
			metricsVersion: postAnalysis.metricsVersion,
		})
	) {
		return { action: 'reused' };
	}

	const baselineNodes = readNodeSidecar(BASELINES_DIR, pin, postAnalysis.metricsVersion);
	if (baselineNodes === null) {
		console.error(
			`${label}: no node census for ${fixtureRef} at metricsVersion ` +
				`${postAnalysis.metricsVersion ?? 'none'}. Run: pnpm results:analyze --recompute`,
		);
		return { action: 'skipped' };
	}

	return { action: 'judge', pin, fixtureRef, dsPackages, baselineNodes };
}

/** Judge one run, or explain why it cannot be judged. */
async function judgeOne(
	run: Run,
	options: Options,
	spent: JudgeUsage,
): Promise<'judged' | 'reused' | 'skipped'> {
	const plan = planRun(run, options);
	if (plan.action !== 'judge') {
		return plan.action;
	}

	// Checked once the cheap local work has had its chance to fail, so a
	// misconfigured environment surfaces every other problem in the same pass.
	assertApiKey();

	const label = labelOf(run);
	console.log(`Judging ${label} against ${dsDocsRefLabel()}`);
	const { report, usage } = await judgeRun({
		runDir: run.runDir,
		projectDir: run.projectDir,
		baselineDir: prepareRef(REF_CACHE_DIR, plan.pin.repo, plan.pin.ref),
		baselineNodes: plan.baselineNodes,
		dsPackages: plan.dsPackages,
		fixtureRef: plan.fixtureRef,
		metricsVersion: postAnalysis.metricsVersion,
		refCacheDir: REF_CACHE_DIR,
	});
	writeMisuseReport(run.runDir, report);
	addUsage(spent, usage);

	const { correctDsDecision, correctDsUsage, correctLocalDecision, evaluated } = report.summary;
	console.log(
		`  ${evaluated.ds} DS / ${evaluated.local} local nodes — ` +
			`decision ${correctDsDecision ?? '-'}, usage ${correctDsUsage ?? '-'}, ` +
			`local ${correctLocalDecision ?? '-'}`,
	);
	console.log(
		`  ~$${usdOf(usage).toFixed(2)} — in ${tokens(usage.inputTokens)} · ` +
			`cache read ${tokens(usage.cacheReadTokens)} · cache write ${tokens(usage.cacheWriteTokens)} · ` +
			`out ${tokens(usage.outputTokens)}`,
	);
	return 'judged';
}

/** Print what a real pass would do, and spend nothing doing it. */
function dryRun(runs: Run[], options: Options): void {
	const counts = { judge: 0, reused: 0, skipped: 0 };
	for (const run of runs) {
		const plan = planRun(run, options);
		if (plan.action === 'judge') {
			console.log(`Would judge ${labelOf(run)} against ${dsDocsRefLabel()}`);
		}
		counts[plan.action] += 1;
	}

	console.log(
		`\nWould judge ${counts.judge} (one model call each), ` +
			`reuse ${counts.reused}, skip ${counts.skipped}. Nothing spent.`,
	);
	if (counts.reused > 0) console.log('Pass --recompute to re-judge cached runs.');
}

async function main() {
	const options = await applyPlanScope(parseOptions(process.argv.slice(2)));

	if (!existsSync(RESULTS_DIR)) {
		console.log('No results/ directory; nothing to judge.');
		return;
	}

	const selected = selectRuns(findRuns(RESULTS_DIR), options);
	// A run whose project tree was never collected has nothing to diff against
	// its baseline, and the judge scores a diff. Dropped here rather than left to
	// fail one by one downstream: --latest points at the newest result directory
	// per experiment, which is exactly where an interrupted sweep leaves its
	// uncollected runs, and a paid command should say "nothing to judge" before
	// it says it per run.
	const runs = selected.filter((run) => run.collected);
	const uncollected = selected.length - runs.length;
	if (uncollected > 0) {
		console.log(`Skipping ${uncollected} run(s) that left no project tree behind.`);
	}
	if (runs.length === 0) {
		console.log('No runs matched.');
		return;
	}

	if (options.dry) {
		dryRun(runs, options);
		return;
	}

	const counts = { judged: 0, reused: 0, skipped: 0, failed: 0 };
	const spent: JudgeUsage = {
		inputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
	};
	for (const run of runs) {
		try {
			counts[await judgeOne(run, options, spent)] += 1;
		} catch (error) {
			// One broken run must not cost us the others — but an absent API key
			// will fail every remaining run identically, so stop on it.
			counts.failed += 1;
			const message = messageOf(error);
			console.error(`${labelOf(run)}: ${message}`);
			if (message.includes('ANTHROPIC_API_KEY')) throw error;
		}
	}

	console.log(
		`\nJudged ${counts.judged}, reused ${counts.reused}, skipped ${counts.skipped}, failed ${counts.failed}.`,
	);
	if (counts.judged > 0) {
		console.log(
			`Spent ~$${usdOf(spent).toFixed(2)} ` +
				`(${tokens(spent.inputTokens)} in · ${tokens(spent.cacheReadTokens)} cache read · ` +
				`${tokens(spent.cacheWriteTokens)} cache write · ${tokens(spent.outputTokens)} out).`,
		);
	}
	if (counts.reused > 0) console.log('Pass --recompute to re-judge cached runs.');
}

main().catch((error) => {
	console.error(messageOf(error));
	process.exit(1);
});
