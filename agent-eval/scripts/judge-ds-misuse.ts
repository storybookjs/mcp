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
// Usage: pnpm judge:ds-misuse [--experiment=<name>] [--since=<ISO date>] [--latest] [--recompute]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareRef, typecheckExternalRepo } from '#lib/agentic-reference/external-repo';
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
import { findRuns, selectRuns, type Run } from '#lib/post-analysis/discovery';
import { readJson } from '#lib/utils/files';
import { isRecord } from '#lib/utils/type';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const BASELINES_DIR = join(ROOT, 'baselines');
const REF_CACHE_DIR = join(ROOT, '.eval-cache/refs');

interface Options {
	experiment: string | null;
	since: string | null;
	latest: boolean;
	recompute: boolean;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { experiment: null, since: null, latest: false, recompute: false };
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		if (flag === '--latest') options.latest = true;
		else if (flag === '--recompute') options.recompute = true;
		else if (flag === '--experiment' && value) options.experiment = value;
		else if (flag === '--since' && value) options.since = value;
		else
			throw new Error(
				`Unknown argument "${arg}". See the usage comment in scripts/judge-ds-misuse.ts.`,
			);
	}
	return options;
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

/** Judge one run, or explain why it cannot be judged. */
async function judgeOne(run: Run, options: Options): Promise<'judged' | 'reused' | 'skipped'> {
	const label = `${run.experiment}/${run.evalName}/run-${run.run}`;

	const pin = pinOf(run.runDir);
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

	const baselineNodes = readNodeSidecar(BASELINES_DIR, pin, postAnalysis.metricsVersion);
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
	const options = parseArgs(process.argv.slice(2));

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
	for (const run of runs) {
		try {
			counts[await judgeOne(run, options)] += 1;
		} catch (error) {
			// One broken run must not cost us the others — but an absent API key
			// will fail every remaining run identically, so stop on it.
			counts.failed += 1;
			const message = messageOf(error);
			console.error(`${run.experiment}/${run.evalName}/run-${run.run}: ${message}`);
			if (message.includes('ANTHROPIC_API_KEY')) throw error;
		}
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
