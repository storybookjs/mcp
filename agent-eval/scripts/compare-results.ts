// results:compare — compares a control case against treatment cases over
// recorded run artifacts and produces estimates, FDR verdicts, and curves.
// Orchestration only: resolution/gating/emission logic lives in
// lib/agentic-reference/comparison/, statistics in scripts/compare_stats.py.
// Spec: docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONTROL_CASE } from '#lib/agentic-reference/cases';
import { COMPARISON_METRICS } from '#lib/agentic-reference/comparison-metrics';
import { autoSelectWorkflows, buildCells } from '#lib/agentic-reference/comparison/cells';
import { formatGapTable, remediationCommands } from '#lib/agentic-reference/comparison/commands';
import {
	datasetCsv,
	manifestJson,
	type ComparisonSpec,
} from '#lib/agentic-reference/comparison/emit';
import { parseCompareArgs } from '#lib/agentic-reference/comparison/options';
import {
	comparisonSlug,
	knownWorkflows,
	resolveCase,
	resolveTreatments,
	resolveWorkflows,
} from '#lib/agentic-reference/comparison/resolve';
import { ansiStyle } from '#lib/agentic-reference/comparison/style';
import { findUv } from '#lib/agentic-reference/comparison/uv';
import { postAnalysis } from '#lib/agentic-reference/post-analysis';
import { findRuns } from '#lib/post-analysis/runs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = process.env.AGENT_EVAL_RESULTS_DIR ?? join(ROOT, 'results');
const EVALS_DIR = process.env.AGENT_EVAL_EVALS_DIR ?? join(ROOT, 'evals');
const STATS_SCRIPT = join(ROOT, 'scripts', 'compare_stats.py');
const errStyle = ansiStyle(process.stderr);
const outStyle = ansiStyle(process.stdout);

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main() {
	const options = parseCompareArgs(process.argv.slice(2));
	const metricsVersion = postAnalysis.metricsVersion;
	const runs = findRuns(RESULTS_DIR);

	const control = resolveCase(options.control ?? DEFAULT_CONTROL_CASE);
	const experimentsWithData = [...new Set(runs.map((run) => run.experiment))];
	const treatments = resolveTreatments(options.cases, control, experimentsWithData);
	if (treatments.length === 0) {
		fail('No treatment cases with recorded data. Collect runs first: pnpm eval:agentic-ref');
	}
	const cases = [control, ...treatments];

	const known = knownWorkflows(EVALS_DIR);
	const explicit = resolveWorkflows(options.workflows, known);
	let workflows: string[];
	if (explicit === null) {
		const candidates = [...new Set(runs.map((run) => run.evalName))]
			.filter((name) => /^7\d\d-/.test(name))
			.sort();
		const auto = autoSelectWorkflows({
			runs,
			cases,
			candidates,
			minRuns: options.minRuns,
			allBatches: options.allBatches,
			metricsVersion,
		});
		if (auto.skipped.length > 0) {
			console.log(outStyle.bold('Skipping the following workflows:'));
			for (const { workflow } of auto.skipped) console.log(`  ${workflow}`);
		}
		if (auto.selected.length === 0) {
			const gaps = auto.skipped.flatMap((s) => s.gaps);
			console.error(`${errStyle.bold('No workflow has enough data for every selected case.')}\n`);
			console.error(formatGapTable(gaps, errStyle));
			console.error(`\n${errStyle.bold('Collect the missing data:')}\n`);
			for (const command of remediationCommands(gaps)) console.error(`  ${command}`);
			process.exit(1);
		}
		workflows = auto.selected;
		console.log(`${outStyle.bold('Auto-selected workflows:')} ${workflows.join(', ')}`);
	} else {
		workflows = explicit;
	}

	const { cells, gaps } = buildCells({
		runs,
		cases,
		workflows,
		minRuns: options.minRuns,
		allBatches: options.allBatches,
		metricsVersion,
	});
	if (gaps.length > 0) {
		console.error(`${errStyle.bold('Comparison impossible: insufficient usable data.')}\n`);
		console.error(formatGapTable(gaps, errStyle));
		console.error(`\n${errStyle.bold('Collect the missing data, then re-run this command:')}\n`);
		for (const command of remediationCommands(gaps)) console.error(`  ${command}`);
		process.exit(1);
	}

	const spec: ComparisonSpec = {
		control,
		treatments,
		workflows,
		mode: workflows.length > 1 ? 'aggregate' : 'single-workflow',
		minRuns: options.minRuns,
		allBatches: options.allBatches,
	};
	const outDir = resolve(
		options.out ?? join(ROOT, 'comparisons', comparisonSlug(control, treatments, workflows)),
	);
	const stagingDir = `${outDir}.staging`;
	rmSync(stagingDir, { recursive: true, force: true });
	mkdirSync(stagingDir, { recursive: true });

	let gitSha: string | null = null;
	try {
		gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
	} catch {
		// Not fatal: provenance only.
	}
	writeFileSync(join(stagingDir, 'dataset.csv'), datasetCsv(cells, COMPARISON_METRICS, spec));
	writeFileSync(
		join(stagingDir, 'manifest.json'),
		manifestJson({
			spec,
			metrics: COMPARISON_METRICS,
			cells,
			agentEvalRoot: ROOT,
			provenance: {
				generatedAt: new Date().toISOString(),
				gitSha,
				metricsVersion: metricsVersion ?? null,
			},
		}),
	);

	const uv = findUv();
	if (uv === null) {
		console.error(`Dataset and manifest written to ${stagingDir}.`);
		console.error('uv is missing, so the statistics stage cannot run here.');
		console.error('Run `pnpm results:compare:setup`, or elsewhere:');
		console.error(`  uv run --frozen scripts/compare_stats.py ${stagingDir}`);
		process.exit(1);
	}
	try {
		execFileSync(uv, ['run', '--frozen', STATS_SCRIPT, stagingDir], {
			stdio: 'inherit',
			cwd: ROOT,
		});
	} catch {
		fail(
			`Statistics stage failed; staging kept at ${stagingDir}. Previous outputs (if any) at ${outDir} are untouched.`,
		);
	}

	rmSync(outDir, { recursive: true, force: true });
	renameSync(stagingDir, outDir);
	console.log(`\nComparison written to ${outDir}`);
	console.log(`Report: ${join(outDir, 'report.md')}`);
}

main().catch((error) => {
	console.error(messageOf(error));
	process.exit(1);
});
