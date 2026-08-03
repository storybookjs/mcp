// Post-run analysis shared by every agentic-reference experiment.
//
// Carried by each experiment as its `postAnalysis` and invoked by
// scripts/analyze-results.ts, which knows only this module's exported shape.
// Which metrics matter, and how they are computed, lives here and under
// metrics/ and tree/; where the numbers are stored is the runner's business.
//
// It lives in lib/ rather than beside an eval because the arms sharing it differ
// only in prompt and MCP endpoint — and because nothing under lib/ is uploaded to
// a sandbox, so the agent under evaluation cannot read the definitions of the
// metrics scoring it.
//
// analyzeRun measures a single tree — a run's collected project, or (in
// `baseline` mode) the pinned upstream tree the runner materialized for us.
// Everything comparative lives in deltaToBaseline, which is therefore
// the only entry point here that needs the external repo on disk.
import { complexityForTree, complexityForFiles, sumComplexities } from './metrics/complexity.ts';
import { computeChurn } from './metrics/churn.ts';
import { readCost, readSpeed } from './metrics/run-signals.ts';
import { classifyToolUse } from './metrics/tool-taxonomy.ts';
import { diffTrees } from './tree/tree-diff.ts';

import type { FileComplexity } from './metrics/complexity.ts';
import type {
	Analysis,
	DeltaToBaselineContext,
	PostAnalysis,
	PostAnalysisContext,
} from '../post-analysis/types.ts';
import { finiteNumbers, mean, round, sum } from '../utils/math.ts';
import { isRecord } from '../utils/type.ts';

/** Transcript events, or null when the transcript has no usable `events` array. */
function transcriptEvents(transcript: unknown): unknown[] | null {
	return isRecord(transcript) && Array.isArray(transcript.events) ? transcript.events : null;
}

export function analyzeRun(context: PostAnalysisContext): Analysis {
	// The pinned tree is measured whole: which of its files matter is not known
	// until a run has been diffed against it, and by then it may be long gone.
	if (context.mode === 'baseline') {
		return { ...complexityForTree(context.projectDir) };
	}

	const { evalName, experiment, model, pin, result, run, timestamp, transcript } = context;
	const events = transcriptEvents(transcript);

	return {
		experiment: experiment,
		eval: evalName,
		run: run,
		model: model,
		timestamp: timestamp,
		// Recorded even though nothing here reads the tree: an aggregate silently
		// spanning two pins is not one measurement, and summarize checks for it.
		fixtureRef: pin === null ? null : `${pin.repo}@${pin.ref.slice(0, 12)}`,
		status: isRecord(result) ? (result.status ?? null) : null,

		speed: readSpeed(result),
		cost: readCost(result),

		toolUse: events === null ? null : classifyToolUse(events),
		churn: events === null ? null : computeChurn(events),
	};
}

/** The whole-tree complexity map analyzeRun stored for the pinned baseline. */
function baselineFiles(analysis: Analysis): Record<string, FileComplexity> {
	const files = analysis.files;
	return isRecord(files) ? (files as Record<string, FileComplexity>) : {};
}

/**
 * The baseline's scores for just the files this run touched. A file the agent
 * created has no baseline entry, so it contributes nothing on the baseline side.
 */
function scoresFor(
	files: Record<string, FileComplexity>,
	paths: string[],
): Record<string, FileComplexity> {
	return Object.fromEntries(paths.flatMap((path) => (files[path] ? [[path, files[path]]] : [])));
}

function addComplexity(a: FileComplexity, b: FileComplexity): FileComplexity {
	return {
		cyclomatic: a.cyclomatic + b.cyclomatic,
		cognitive: a.cognitive + b.cognitive,
		jsxCyclomatic: a.jsxCyclomatic + b.jsxCyclomatic,
		jsxCognitive: a.jsxCognitive + b.jsxCognitive,
	};
}

function subtractComplexity(a: FileComplexity, b: FileComplexity): FileComplexity {
	return {
		cyclomatic: a.cyclomatic - b.cyclomatic,
		cognitive: a.cognitive - b.cognitive,
		jsxCyclomatic: a.jsxCyclomatic - b.jsxCyclomatic,
		jsxCognitive: a.jsxCognitive - b.jsxCognitive,
	};
}

export function deltaToBaseline({
	baselineAnalysis,
	baselineDir,
	projectDir,
}: DeltaToBaselineContext): Analysis {
	const diff = diffTrees(baselineDir, projectDir);

	// No extension filter: complexityForFiles already skips anything without an
	// AST, so .css participates in the SLoC diff and drops out here on its own.
	const baseline = baselineFiles(baselineAnalysis);
	const afterFiles = complexityForFiles(projectDir, diff.files);

	// Whole-project totals, not just the touched subset — otherwise `before` and
	// `after` are sums over an arbitrary file set and only their difference means
	// anything. Rebuilding `after` as "the baseline, with the touched files
	// swapped for what the agent left behind" keeps both ends comparable across
	// runs while leaving the delta exactly what it was.
	const before = sumComplexities(baseline);
	const after = addComplexity(
		subtractComplexity(before, sumComplexities(scoresFor(baseline, diff.files))),
		sumComplexities(afterFiles.files),
	);
	const cognitiveDelta = after.cognitive - before.cognitive;

	return {
		diff,
		complexity: {
			cyclomatic: {
				before: before.cyclomatic,
				after: after.cyclomatic,
				delta: after.cyclomatic - before.cyclomatic,
			},
			cognitive: {
				before: before.cognitive,
				after: after.cognitive,
				delta: cognitiveDelta,
			},
			// JSX-aware variants (complexity-jsx.ts): the classic scores plus
			// markup length, depth and conditional renders, so an agent bloating
			// render trees moves these even when the branching logic stays flat.
			jsxCyclomatic: {
				before: before.jsxCyclomatic,
				after: after.jsxCyclomatic,
				delta: after.jsxCyclomatic - before.jsxCyclomatic,
			},
			jsxCognitive: {
				before: before.jsxCognitive,
				after: after.jsxCognitive,
				delta: after.jsxCognitive - before.jsxCognitive,
			},
			// Complexity correlates ~0.9 with lines of code, so a bare delta partly
			// re-measures verbosity. null rather than Infinity when nothing changed:
			// a stored Infinity would poison every later mean.
			densityPerSloc: diff.sloc.net === 0 ? null : cognitiveDelta / diff.sloc.net,
			parseFailures: afterFiles.parseFailures,
		},
	};
}

/** Comparative metrics, under the key analyze-results.ts nests them at. */
function deltaOf(row: Record<string, unknown>): {
	diff?: { sloc?: { added?: number } };
	complexity?: { cognitive?: { delta?: number }; jsxCognitive?: { delta?: number } };
} {
	return isRecord(row.deltaToBaseline) ? row.deltaToBaseline : {};
}

function numbersAt(
	rows: Array<Record<string, unknown>>,
	read: (row: Record<string, unknown>) => unknown,
): number[] {
	return finiteNumbers(rows.map(read));
}

function makeGeneralSummary(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const groups = new Map<string, Array<Record<string, unknown>>>();
	for (const row of rows) {
		const key = `${String(row.experiment)}::${String(row.eval)}`;
		const existing = groups.get(key);
		if (existing) existing.push(row);
		else groups.set(key, [row]);
	}

	return [...groups.values()].map((group) => {
		const costs = numbersAt(
			group,
			(row) => (row.cost as { estimatedCostUsd?: number } | null)?.estimatedCostUsd,
		);
		const durations = numbersAt(
			group,
			(row) => (row.speed as { durationSeconds?: number } | null)?.durationSeconds,
		);
		const docs = numbersAt(
			group,
			(row) => (row.toolUse as { buckets?: { docs?: number } } | null)?.buckets?.docs,
		);
		const exploration = numbersAt(
			group,
			(row) => (row.toolUse as { buckets?: { exploration?: number } } | null)?.buckets?.exploration,
		);
		const slocAdded = numbersAt(group, (row) => deltaOf(row).diff?.sloc?.added);
		const cognitiveDelta = numbersAt(group, (row) => deltaOf(row).complexity?.cognitive?.delta);
		const jsxCognitiveDelta = numbersAt(
			group,
			(row) => deltaOf(row).complexity?.jsxCognitive?.delta,
		);

		// An aggregate silently spanning two pins is not one measurement.
		const fixtureRefs = [...new Set(group.map((row) => String(row.fixtureRef)))];

		return {
			experiment: group[0]?.experiment,
			eval: group[0]?.eval,
			fixtureRefs,
			runs: group.length,
			passed: group.filter((row) => row.status === 'passed').length,
			// null rather than 0 when nothing priced, so an unpriced model does not
			// read as a free one.
			costUsd: {
				total: round(sum(costs)),
				reported: costs.length,
			},
			durationSeconds: { mean: round(mean(durations)) },
			docCalls: { mean: round(mean(docs)) },
			explorationCalls: { mean: round(mean(exploration)) },
			slocAdded: { mean: round(mean(slocAdded)) },
			cognitiveDelta: { mean: round(mean(cognitiveDelta)) },
			jsxCognitiveDelta: { mean: round(mean(jsxCognitiveDelta)) },
		};
	});
}

/**
 * Called with run-1..run-N of a single eval directory, so the experiment::eval
 * grouping below collapses to one row: the averages for that arm at that
 * timestamp. The runner writes it into that directory's summary.json under
 * `postAnalysis` and collects every row into results/analysis-summary.json.
 *
 * The console view and the returned rows are deliberately different shapes —
 * the tables flatten costUsd to a number to stay readable, the stored rows keep
 * {total, reported} so a later reader can tell 0 from unpriced.
 */
export function summarize(
	analyses: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
	console.table(
		analyses.map((row) => ({
			experiment: String(row.experiment).replace(/^agentic-ref-/, ''),
			run: row.run,
			status: row.status,
			seconds: (row.speed as { durationSeconds?: number } | null)?.durationSeconds ?? null,
			turns: (row.speed as { turns?: number } | null)?.turns ?? null,
			costUsd: (row.cost as { estimatedCostUsd?: number } | null)?.estimatedCostUsd ?? null,
			docs: (row.toolUse as { buckets?: { docs?: number } } | null)?.buckets?.docs ?? null,
			explore:
				(row.toolUse as { buckets?: { exploration?: number } } | null)?.buckets?.exploration ??
				null,
			slocAdded: deltaOf(row).diff?.sloc?.added ?? null,
			cognitive: deltaOf(row).complexity?.cognitive?.delta ?? null,
			jsxCog: deltaOf(row).complexity?.jsxCognitive?.delta ?? null,
		})),
	);

	const summary = makeGeneralSummary(analyses);
	console.table(
		summary.map((group) => ({
			experiment: String(group.experiment).replace(/^agentic-ref-/, ''),
			fixtureRef:
				(group.fixtureRefs as string[]).length === 1
					? (group.fixtureRefs as string[])[0]
					: `mixed (${(group.fixtureRefs as string[]).length})`,
			runs: group.runs,
			passed: group.passed,
			costUsd: (group.costUsd as { total: number | null }).total,
			secondsMean: (group.durationSeconds as { mean: number | null }).mean,
			docsMean: (group.docCalls as { mean: number | null }).mean,
			exploreMean: (group.explorationCalls as { mean: number | null }).mean,
			slocMean: (group.slocAdded as { mean: number | null }).mean,
			cognitiveMean: (group.cognitiveDelta as { mean: number | null }).mean,
			jsxCogMean: (group.jsxCognitiveDelta as { mean: number | null }).mean,
		})),
	);

	return summary;
}

/**
 * What every agentic-reference experiment hands to the offline analyzer.
 *
 * metricsVersion invalidates committed baselines when a metric definition or
 * its stored shape changes, so a baseline measured under old rules is rebuilt
 * rather than silently compared against runs measured under new ones. Bumped
 * to 2 when FileComplexity gained the jsxCyclomatic/jsxCognitive scores.
 */
export const postAnalysis: PostAnalysis = {
	analyzeRun,
	deltaToBaseline,
	summarize,
	metricsVersion: 2,
};
