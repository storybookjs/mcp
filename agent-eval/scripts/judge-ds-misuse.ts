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
// Usage: pnpm judge:ds-misuse [--experiments <list>] [--evals <list>] [--since <ISO date>]
//                             [--latest] [--recompute]
//
//   --experiments <list>  only runs under results/<name>/, by name or glob
//   --evals <list>        only runs of these evals, by name, number (706) or glob
//   --since <ISO date>    only runs whose result directory is stamped on or after
//   --latest              only the newest result directory per experiment
//   --recompute           re-judge runs that already carry a usable judgement
//                         (alias: --force) — this is the flag that spends money
//
// Selection follows the shared grammar in lib/agentic-reference/selection.ts, and
// the flag shapes themselves come from lib/post-analysis/discovery.ts, so this
// CLI and results:analyze cannot drift on what a selection means: --cases and
// --flows are aliases, singular and plural spellings are the same flag, lists
// take commas or repetition, and --flag=value works as well as --flag value.
//
// Every flag also falls back to AGENTIC_REF_<FLAG>, which for --recompute means
// an exported AGENTIC_REF_RECOMPUTE re-judges — and therefore re-spends — on
// every invocation. Its --force spelling stays command-line only, matching
// results:analyze.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pinOfResult, prepareRef } from '#lib/agentic-reference/external-repo';
import { dsPackagesForPin } from '#lib/agentic-reference/metrics/coverage';
import { dsDocsRefLabel } from '#lib/agentic-reference/metrics/ds-misuse/ds-docs';
import {
	isStale,
	judgeRun,
	readMisuseReport,
	writeMisuseReport,
} from '#lib/agentic-reference/metrics/ds-misuse/index';
import { assertApiKey } from '#lib/agentic-reference/metrics/ds-misuse/judge';
import { selectionFlags } from '#lib/agentic-reference/selection';
import { readDsCoverageNodeList } from '#lib/post-analysis/baseline';
import {
	findRuns,
	runSelectionOptions,
	selectRuns,
	toRunSelection,
	type Run,
	type RunSelection,
} from '#lib/post-analysis/discovery';
import { createPostAnalysisLoader } from '#lib/post-analysis/hooks';
import { readJson } from '#lib/utils/files';
import { messageOf } from '#lib/utils/error';

import type { PostAnalysis } from '#lib/post-analysis/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const BASELINES_DIR = join(ROOT, 'baselines');
const REF_CACHE_DIR = join(ROOT, '.eval-cache/refs');

// Which module measured a run is the experiment's call, exactly as it is in
// results:analyze — and it decides both what this costs and whether it is right.
// A run whose experiment names no module is not ours to judge, and the node-list
// and staleness checks below are keyed on *that* module's metricsVersion rather
// than on whichever one happened to be imported at the top of this file.
const loadPostAnalysis = createPostAnalysisLoader([
	join(ROOT, 'experiments'),
	join(ROOT, '.agentic-ref', 'experiments'),
]);

interface Options extends RunSelection {
	recompute: boolean;
}

function parseOptions(argv: string[]): Options {
	const flags = selectionFlags(process.env);
	const parsed = flags
		.parser(
			argv,
			{ scriptName: 'judge:ds-misuse', usage: 'Usage: pnpm judge:ds-misuse [flags]' },
			{
				...runSelectionOptions(flags),
				recompute: {
					...flags.switch('recompute', 'Re-judge runs that already carry a usable judgement'),
					alias: ['force'],
				},
			},
		)
		.parseSync();

	return { ...toRunSelection(parsed), recompute: parsed.recompute === true };
}

/** Judge one run, or explain why it cannot be judged. */
async function judgeOne(
	run: Run,
	postAnalysis: PostAnalysis,
	options: Options,
): Promise<'judged' | 'reused' | 'skipped'> {
	const label = `${run.experiment}/${run.evalName}/run-${run.run}`;

	const pin = pinOfResult(readJson(join(run.runDir, 'result.json')));
	if (pin === null) {
		console.error(`${label}: recorded no usable evals.externalRepo pin, so it has no baseline.`);
		return 'skipped';
	}
	const fixtureRef = `${pin.repo}@${pin.ref}`;

	const dsPackages = dsPackagesForPin(pin);
	if (dsPackages === null) {
		console.error(
			`${label}: ${fixtureRef} declares no DS packages. ` +
				'Add it to DS_PACKAGES_BY_PIN in lib/agentic-reference/metrics/coverage.ts.',
		);
		return 'skipped';
	}

	const existing = options.recompute ? null : readMisuseReport(run.runDir);
	if (
		existing &&
		!isStale(existing, {
			dsGuidelinesRef: dsDocsRefLabel(),
			metricsVersion: postAnalysis.metricsVersion,
		})
	) {
		return 'reused';
	}

	const baselineNodes = readDsCoverageNodeList(BASELINES_DIR, pin, postAnalysis.metricsVersion);
	if (baselineNodes === null) {
		console.error(
			`${label}: no node census for ${fixtureRef} at metricsVersion ` +
				`${postAnalysis.metricsVersion ?? 'none'}. Run: pnpm results:analyze --recompute`,
		);
		return 'skipped';
	}

	// Checked once the cheap local work has had its chance to fail, so a
	// misconfigured environment surfaces every other problem in the same pass.
	assertApiKey();

	console.log(`Judging ${label} against ${dsDocsRefLabel()}`);
	const report = await judgeRun({
		runDir: run.runDir,
		projectDir: run.projectDir,
		baselineDir: prepareRef(REF_CACHE_DIR, pin.repo, pin.ref),
		baselineNodes,
		dsPackages,
		fixtureRef,
		metricsVersion: postAnalysis.metricsVersion,
		refCacheDir: REF_CACHE_DIR,
	});
	if (report === null) {
		console.error(
			`${label}: its diff touches no judgeable source file, so there are no new ` +
				'nodes to score. Nothing was spent.',
		);
		return 'skipped';
	}
	writeMisuseReport(run.runDir, report);

	const { correctDsDecision, correctDsUsage, correctLocalDecision, evaluated } = report.summary;
	console.log(
		`  ${evaluated.ds} DS / ${evaluated.local} local nodes — ` +
			`decision ${correctDsDecision ?? '-'}, usage ${correctDsUsage ?? '-'}, ` +
			`local ${correctLocalDecision ?? '-'}`,
	);
	return 'judged';
}

async function main() {
	const options = parseOptions(process.argv.slice(2));

	if (!existsSync(RESULTS_DIR)) {
		console.log('No results/ directory; nothing to judge.');
		return;
	}

	const runs = selectRuns(findRuns(RESULTS_DIR), options);
	if (runs.length === 0) {
		console.log('No runs matched.');
		return;
	}

	const counts = { judged: 0, reused: 0, skipped: 0, failed: 0 };
	const loadFailures: string[] = [];
	let withoutHook = 0;

	for (const run of runs) {
		// The experiment names the module that measured this run; if it names none,
		// results:analyze never measured it and this must not pay to judge it.
		// Resolved before anything else so that skip costs nothing at all.
		const postAnalysis = await loadPostAnalysis(run.experiment, loadFailures);
		if (postAnalysis === null) {
			withoutHook += 1;
			continue;
		}

		try {
			counts[await judgeOne(run, postAnalysis, options)] += 1;
		} catch (error) {
			// One broken run must not cost us the others — but an absent API key
			// will fail every remaining run identically, so stop on it.
			counts.failed += 1;
			const message = messageOf(error);
			console.error(`${run.experiment}/${run.evalName}/run-${run.run}: ${message}`);
			if (message.includes('ANTHROPIC_API_KEY')) throw error;
		}
	}

	for (const message of loadFailures) console.error(`Could not load ${message}`);
	if (withoutHook > 0) {
		console.log(
			`Skipped ${withoutHook} ${withoutHook === 1 ? 'run' : 'runs'} whose experiment carries no postAnalysis.`,
		);
	}

	console.log(
		`\nJudged ${counts.judged}, reused ${counts.reused}, skipped ${counts.skipped}, failed ${counts.failed}.`,
	);
	if (counts.reused > 0) console.log('Pass --recompute to re-judge cached runs.');
}

main().catch((error) => {
	console.error(messageOf(error));
	process.exit(1);
});
