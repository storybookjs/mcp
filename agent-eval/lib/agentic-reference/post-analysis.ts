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
import {
	COMPLEXITY_KEYS,
	complexityForTree,
	complexityForFiles,
	sumComplexities,
} from './metrics/complexity.ts';
import { computeChurn } from './metrics/churn.ts';
import {
	coverageDelta,
	dsPackagesForPin,
	isDsCoverage,
	measureDsCoverage,
	sameDsPackages,
} from './metrics/coverage.ts';
import { readCost, readSpeed } from './metrics/run-signals.ts';
import { classifyToolUse } from './metrics/tool-taxonomy.ts';
import { parseResultTimestamp } from './comparability.ts';
import { diffTrees } from './tree/tree-diff.ts';

import type { FileComplexity } from './metrics/complexity.ts';
import type { CoverageDelta, DsCoverage } from './metrics/coverage.ts';
import type {
	Analysis,
	DeltaToBaselineContext,
	PostAnalysis,
	PostAnalysisContext,
	SummarizeOptions,
} from '../post-analysis/types.ts';
import { finiteNumbers, mean, round, sum } from '../utils/math.ts';
import { printTable } from '../utils/table.ts';
import { isRecord } from '../utils/type.ts';

/** Transcript events, or null when the transcript has no usable `events` array. */
function transcriptEvents(transcript: unknown): unknown[] | null {
	return isRecord(transcript) && Array.isArray(transcript.events) ? transcript.events : null;
}

/**
 * The tree's DS coverage, or null when the run's pin declares no DS packages.
 * Measured on both sides of a delta the same way — whole tree, same patterns —
 * so the baseline's copy can be committed and reused rather than recomputed per
 * run, exactly like the complexity map beside it.
 *
 * The pin is what selects the patterns, so a run whose eval fixture has since
 * been renamed or deleted is still measured: what the tree is made of did not
 * change when the fixture did.
 */
function dsCoverageOf(context: PostAnalysisContext): DsCoverage | null {
	const dsPackages = dsPackagesForPin(context.pin);
	return dsPackages === null ? null : measureDsCoverage(context.projectDir, dsPackages);
}

export function analyzeRun(context: PostAnalysisContext): Analysis {
	// The pinned tree is measured whole: which of its files matter is not known
	// until a run has been diffed against it, and by then it may be long gone.
	if (context.mode === 'baseline') {
		return {
			...complexityForTree(context.projectDir),
			dsCoverage: dsCoverageOf(context),
		};
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

		// Absolute, not comparative: how much of the UI the run left behind comes
		// from the design system. deltaToBaseline reuses this rather than
		// re-measuring, and turns it into coverageDelta against the pinned tree.
		dsCoverage: dsCoverageOf(context),
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

function combineComplexity(
	a: FileComplexity,
	b: FileComplexity,
	combine: (left: number, right: number) => number,
): FileComplexity {
	return Object.fromEntries(
		COMPLEXITY_KEYS.map((key) => [key, combine(a[key], b[key])]),
	) as unknown as FileComplexity;
}

/** Average tree depth for one side of the delta; null when the side has no trees. */
function averageDepth(totals: FileComplexity): number | null {
	return totals.jsxTrees === 0 ? null : totals.jsxDepthTotal / totals.jsxTrees;
}

/**
 * The pinned tree's coverage, re-measured when the committed baseline cannot
 * serve it. metricsVersion invalidates a baseline when a metric *definition*
 * moves, but DS_PACKAGES_BY_PIN can gain or change an entry without it — and a
 * delta whose two sides counted different packages is not a delta at all. The
 * same path catches a baseline committed before coverage existed.
 */
function baselineCoverage(
	baselineAnalysis: Analysis,
	baselineDir: string,
	runCoverage: DsCoverage,
): DsCoverage {
	const stored = baselineAnalysis.dsCoverage;
	if (isDsCoverage(stored) && sameDsPackages(stored.dsPackages, runCoverage.dsPackages)) {
		return stored;
	}
	return measureDsCoverage(baselineDir, runCoverage.dsPackages);
}

/** How coverage moved, or null when this eval measures none. */
function coverageDeltaFor({
	baselineAnalysis,
	baselineDir,
	runAnalysis,
}: DeltaToBaselineContext): CoverageDelta | null {
	const runCoverage = runAnalysis.dsCoverage;
	if (!isDsCoverage(runCoverage)) {
		return null;
	}
	return coverageDelta(baselineCoverage(baselineAnalysis, baselineDir, runCoverage), runCoverage);
}

export function deltaToBaseline(context: DeltaToBaselineContext): Analysis {
	const { baselineAnalysis, baselineDir, projectDir } = context;
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
	const removed = combineComplexity(
		before,
		sumComplexities(scoresFor(baseline, diff.files)),
		(left, right) => left - right,
	);
	const after = combineComplexity(
		removed,
		sumComplexities(afterFiles.files),
		(left, right) => left + right,
	);
	const cognitiveDelta = after.cognitive - before.cognitive;

	const span = (measure: keyof FileComplexity) => ({
		before: before[measure],
		after: after[measure],
		delta: after[measure] - before[measure],
	});

	// Tree depth is a ratio (jsxDepthTotal / jsxTrees), so its delta is a
	// difference of averages, null-guarded for a side with no markup at all.
	const depthBefore = averageDepth(before);
	const depthAfter = averageDepth(after);

	return {
		diff,
		complexity: {
			cyclomatic: span('cyclomatic'),
			cognitive: span('cognitive'),
			// Render-path variants (complexity-jsx.ts): render loops counted, and
			// branches weighted by markup depth on the cognitive side.
			jsxCyclomatic: span('jsxCyclomatic'),
			jsxCognitive: span('jsxCognitive'),
			// Markup size (jsx-structure.ts): tags, dynamic bindings, and the
			// average depth of a JSX tree.
			jsxLength: span('jsxLength'),
			jsxBindings: span('jsxBindings'),
			jsxDepth: {
				before: depthBefore,
				after: depthAfter,
				delta: depthBefore === null || depthAfter === null ? null : depthAfter - depthBefore,
			},
			// Complexity correlates ~0.9 with lines of code, so a bare delta partly
			// re-measures verbosity. null rather than Infinity when nothing changed:
			// a stored Infinity would poison every later mean.
			densityPerSloc: diff.sloc.net === 0 ? null : cognitiveDelta / diff.sloc.net,
			parseFailures: afterFiles.parseFailures,
		},
		// Whole-tree on both sides, so — unlike the complexity family — nothing is
		// reconstructed from the touched subset here.
		coverageDelta: coverageDeltaFor(context),
	};
}

/** Comparative metrics, under the key analyze-results.ts nests them at. */
function deltaOf(row: Record<string, unknown>): {
	diff?: { sloc?: { added?: number; net?: number } };
	complexity?: {
		cyclomatic?: { delta?: number };
		cognitive?: { delta?: number };
		jsxCyclomatic?: { delta?: number };
		jsxCognitive?: { delta?: number };
		jsxLength?: { delta?: number };
		jsxBindings?: { delta?: number };
		jsxDepth?: { delta?: number | null };
		densityPerSloc?: number | null;
		parseFailures?: string[];
	};
	coverageDelta?: CoverageDelta | null;
} {
	return isRecord(row.deltaToBaseline) ? row.deltaToBaseline : {};
}

/** A run's absolute DS coverage, or null when its eval measures none. */
function coverageOf(row: Record<string, unknown>): DsCoverage | null {
	return isDsCoverage(row.dsCoverage) ? row.dsCoverage : null;
}

/** Experiment names share a long prefix; the tables read better without it. */
function shortExperiment(value: unknown): string {
	return String(value)
		.replace(/^agentic-ref-cc-/, '')
		.replace(/-opus-[^-]+$/, '');
}

function shortCase(value: unknown): string {
	return String(value).replace(/(-[^\d]+)+$/, '');
}

/** A stored share (0.0845) as a percentage for display. */
function percent(value: number | null | undefined): string | null {
	const scaled = value === null || value === undefined ? null : round(value * 100, 2);
	return scaled === null ? null : `${scaled}%`;
}

/**
 * A share *delta*, signed: the direction is the whole point of the column, and
 * its Δ heading says the number is a difference of two shares rather than a
 * relative change.
 */
function percentDelta(value: number | null | undefined): string | null {
	const scaled = value === null || value === undefined ? null : round(value * 100, 2);
	return scaled === null ? null : `${scaled > 0 ? '+' : ''}${scaled}%`;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** A minute of local wall-clock time: 2026-08-15 15:20. */
function localMinute(at: Date): string {
	return (
		`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
		`${pad(at.getHours())}:${pad(at.getMinutes())}`
	);
}

/**
 * How a run is labelled in a per-run table: when it was collected, in the
 * reader's own timezone, and which repetition of that collection it was.
 */
function runLabel(row: Record<string, unknown>): string {
	const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
	const stamp = timestamp === null ? null : parseResultTimestamp(timestamp);
	// A directory name that is not a timestamp is still the only thing that
	// dates the run, so it is printed as it stands rather than dropped.
	const when = stamp === null ? (timestamp ?? '?') : localMinute(stamp);
	return `${when} #${typeof row.run === 'number' ? row.run : '?'}`;
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
		const cyclomaticDelta = numbersAt(group, (row) => deltaOf(row).complexity?.cyclomatic?.delta);
		const cognitiveDelta = numbersAt(group, (row) => deltaOf(row).complexity?.cognitive?.delta);
		const jsxCyclomaticDelta = numbersAt(
			group,
			(row) => deltaOf(row).complexity?.jsxCyclomatic?.delta,
		);
		const jsxCognitiveDelta = numbersAt(
			group,
			(row) => deltaOf(row).complexity?.jsxCognitive?.delta,
		);
		const jsxLengthDelta = numbersAt(group, (row) => deltaOf(row).complexity?.jsxLength?.delta);
		const jsxBindingsDelta = numbersAt(group, (row) => deltaOf(row).complexity?.jsxBindings?.delta);
		const jsxDepthDelta = numbersAt(group, (row) => deltaOf(row).complexity?.jsxDepth?.delta);
		const density = numbersAt(group, (row) => deltaOf(row).complexity?.densityPerSloc);
		const parseFailureRuns = group.filter(
			(row) => (deltaOf(row).complexity?.parseFailures?.length ?? 0) > 0,
		).length;

		const dsNodes = numbersAt(group, (row) => coverageOf(row)?.nodes.ds);
		const componentNodes = numbersAt(group, (row) => coverageOf(row)?.nodes.component);
		const unresolvedNodes = numbersAt(group, (row) => coverageOf(row)?.nodes.unresolved);
		const dsShareOfAll = numbersAt(group, (row) => coverageOf(row)?.dsShareOfAllNodes);
		const dsShareOfComponents = numbersAt(group, (row) => coverageOf(row)?.dsShareOfComponentNodes);
		const dsNodesDelta = numbersAt(group, (row) => deltaOf(row).coverageDelta?.nodes.ds.delta);
		const dsShareOfAllDelta = numbersAt(
			group,
			(row) => deltaOf(row).coverageDelta?.dsShareOfAllNodes.delta,
		);
		const dsShareOfComponentsDelta = numbersAt(
			group,
			(row) => deltaOf(row).coverageDelta?.dsShareOfComponentNodes.delta,
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
			cyclomaticDelta: { mean: round(mean(cyclomaticDelta)) },
			cognitiveDelta: { mean: round(mean(cognitiveDelta)) },
			jsxCyclomaticDelta: { mean: round(mean(jsxCyclomaticDelta)) },
			jsxCognitiveDelta: { mean: round(mean(jsxCognitiveDelta)) },
			jsxLengthDelta: { mean: round(mean(jsxLengthDelta)) },
			jsxBindingsDelta: { mean: round(mean(jsxBindingsDelta)) },
			jsxDepthDelta: { mean: round(mean(jsxDepthDelta)) },
			// Mean of per-run ratios, not the ratio of group totals: each run's
			// density is its own measurement, and one huge run must not drown a
			// small one.
			densityPerSloc: { mean: round(mean(density), 3) },
			// Runs whose delta was computed around files the parser gave up on:
			// their complexity numbers are understated, so a nonzero count here
			// says "read these means with care".
			parseFailures: { runs: parseFailureRuns },

			// DS coverage in absolute terms and against the pinned tree. Shares
			// keep four decimals, matching how coverage.ts stores them: a mean
			// rounded to two would flatten a one-point move to nothing.
			dsNodes: { mean: round(mean(dsNodes)) },
			componentNodes: { mean: round(mean(componentNodes)) },
			// Nodes no analysis could classify: they sit in the denominator of
			// dsShareOfAllNodes, so a large number here caps how much of that
			// share is actually known.
			unresolvedNodes: { mean: round(mean(unresolvedNodes)) },
			dsShareOfAllNodes: { mean: round(mean(dsShareOfAll), 4) },
			dsShareOfComponentNodes: { mean: round(mean(dsShareOfComponents), 4) },
			dsNodesDelta: { mean: round(mean(dsNodesDelta)) },
			dsShareOfAllNodesDelta: { mean: round(mean(dsShareOfAllDelta), 4) },
			dsShareOfComponentNodesDelta: {
				mean: round(mean(dsShareOfComponentsDelta), 4),
			},
		};
	});
}

/**
 * Called with the runs of one comparable set (every run of the same experiment,
 * eval and configuration, however many result directories they arrived in).
 */
export function summarize(
	analyses: Array<Record<string, unknown>>,
	options: SummarizeOptions = { general: true, complexity: true, coverage: true },
): Array<Record<string, unknown>> {
	// Computed whichever tables print: these are the rows the runner persists.
	const summary = makeGeneralSummary(analyses);
	if (options.quiet === true) {
		return summary;
	}

	if (options.general) {
		printTable(
			analyses.map((row) => ({
				run: runLabel(row),
				status: row.status,
				seconds: (row.speed as { durationSeconds?: number } | null)?.durationSeconds ?? null,
				turns: (row.speed as { turns?: number } | null)?.turns ?? null,
				costUsd: (row.cost as { estimatedCostUsd?: number } | null)?.estimatedCostUsd ?? null,
				docs: (row.toolUse as { buckets?: { docs?: number } } | null)?.buckets?.docs ?? null,
				explore:
					(row.toolUse as { buckets?: { exploration?: number } } | null)?.buckets?.exploration ??
					null,
				slocAdded: deltaOf(row).diff?.sloc?.added ?? null,
			})),
		);

		printTable(
			summary.map((group) => ({
				experiment: shortExperiment(group.experiment),
				case: shortCase(group.eval),
				fixtureRef:
					(group.fixtureRefs as string[]).length === 1
						? (group.fixtureRefs as string[])[0]
						: `mixed (${(group.fixtureRefs as string[]).length})`,
				runs: group.runs,
				passed: group.passed,
				costUsd: (group.costUsd as { total: number | null }).total,
				'μ seconds': (group.durationSeconds as { mean: number | null }).mean,
				'μ docs': (group.docCalls as { mean: number | null }).mean,
				'μ explore': (group.explorationCalls as { mean: number | null }).mean,
				'μ sloc': (group.slocAdded as { mean: number | null }).mean,
			})),
		);
	}

	// Classic and jsx pairs side by side, so "the logic barely moved but the
	// markup grew" is visible in one row. jsxDepth and density are the only
	// ratios, rounded for display; parseFails marks runs whose numbers are
	// understated because the parser gave up on some files.
	const withDeltas = analyses.filter((row) => deltaOf(row).complexity !== undefined);
	const printedComplexity = options.complexity && withDeltas.length > 0;
	if (printedComplexity) {
		printTable(
			withDeltas.map((row) => {
				const complexity = deltaOf(row).complexity ?? {};
				return {
					run: runLabel(row),
					slocNet: deltaOf(row).diff?.sloc?.net ?? null,
					cyclo: complexity.cyclomatic?.delta ?? null,
					cog: complexity.cognitive?.delta ?? null,
					jsxCyclo: complexity.jsxCyclomatic?.delta ?? null,
					jsxCog: complexity.jsxCognitive?.delta ?? null,
					jsxLen: complexity.jsxLength?.delta ?? null,
					jsxBind: complexity.jsxBindings?.delta ?? null,
					jsxDepth: round(complexity.jsxDepth?.delta ?? null),
					density: round(complexity.densityPerSloc ?? null, 3),
					parseFails: complexity.parseFailures?.length ?? 0,
				};
			}),
		);

		printTable(
			summary.map((group) => ({
				experiment: shortExperiment(group.experiment),
				case: shortCase(group.eval),
				'μ cyclo': (group.cyclomaticDelta as { mean: number | null }).mean,
				'μ cog': (group.cognitiveDelta as { mean: number | null }).mean,
				'μ jsxCyclo': (group.jsxCyclomaticDelta as { mean: number | null }).mean,
				'μ jsxCog': (group.jsxCognitiveDelta as { mean: number | null }).mean,
				'μ jsxLen': (group.jsxLengthDelta as { mean: number | null }).mean,
				'μ jsxBind': (group.jsxBindingsDelta as { mean: number | null }).mean,
				'μ jsxDepth': (group.jsxDepthDelta as { mean: number | null }).mean,
				'μ density': (group.densityPerSloc as { mean: number | null }).mean,
				parseFailRuns: (group.parseFailures as { runs: number }).runs,
			})),
		);
	}

	// Absolute coverage and its movement in one row: a share is only readable
	// next to where it started, and "+3 points" means something very different
	// at 10% than at 80%. unres is the escape hatch on both — nodes no analysis
	// could classify sit in shareAll's denominator, so a large count caps how
	// much of it is known.
	const withCoverage = analyses.filter((row) => coverageOf(row) !== null);
	const printedCoverage = options.coverage && withCoverage.length > 0;
	if (printedCoverage) {
		printTable(
			withCoverage.map((row) => {
				const coverage = coverageOf(row);
				const delta = deltaOf(row).coverageDelta ?? null;
				return {
					run: runLabel(row),
					nodes: coverage?.nodes.all ?? null,
					dsNodes: coverage?.nodes.ds ?? null,
					compNodes: coverage?.nodes.component ?? null,
					shareAll: percent(coverage?.dsShareOfAllNodes),
					shareComp: percent(coverage?.dsShareOfComponentNodes),
					unres: coverage?.nodes.unresolved ?? null,
					dsNodesΔ: delta?.nodes.ds.delta ?? null,
					shareAllΔ: percentDelta(delta?.dsShareOfAllNodes.delta),
					shareCompΔ: percentDelta(delta?.dsShareOfComponentNodes.delta),
				};
			}),
		);

		printTable(
			summary.map((group) => ({
				experiment: shortExperiment(group.experiment),
				case: shortCase(group.eval),
				'μ dsNodes': (group.dsNodes as { mean: number | null }).mean,
				'μ compNodes': (group.componentNodes as { mean: number | null }).mean,
				'μ shareAll': percent((group.dsShareOfAllNodes as { mean: number | null }).mean),
				'μ shareComp': percent((group.dsShareOfComponentNodes as { mean: number | null }).mean),
				'μ unres': (group.unresolvedNodes as { mean: number | null }).mean,
				'μ dsNodesΔ': (group.dsNodesDelta as { mean: number | null }).mean,
				'μ shareAllΔ': percentDelta((group.dsShareOfAllNodesDelta as { mean: number | null }).mean),
				'μ shareCompΔ': percentDelta(
					(group.dsShareOfComponentNodesDelta as { mean: number | null }).mean,
				),
			})),
		);
	}

	// A selected family this eval has no data for prints nothing at all, leaving
	// a bare header that reads as a broken analysis. Coverage gets a pointer
	// rather than a shrug: the one thing that stops a run being measured is a
	// pin nobody has mapped, and the fix is a one-line edit.
	if (!options.general && !printedComplexity && !printedCoverage) {
		if (options.coverage && withCoverage.length === 0) {
			console.log(
				'No DS coverage for these runs: their external-repo pin declares no DS packages. ' +
					'Add it to DS_PACKAGES_BY_PIN in lib/agentic-reference/metrics/coverage.ts.',
			);
		} else if (options.complexity) {
			console.log('Nothing to show: these runs carry no baseline delta.');
		} else {
			console.log('No table families selected.');
		}
	}

	return summary;
}

/**
 * What every agentic-reference experiment hands to the offline analyzer.
 *
 * metricsVersion invalidates committed baselines when a metric definition or
 * its stored shape changes, so a baseline measured under old rules is rebuilt
 * rather than silently compared against runs measured under new ones.
 * History:
 * - 2 added the jsx complexity variants
 * - 3 split markup size into jsx-structure.ts (jsxLength/jsxBindings/jsxDepth)
 *     and absorbed inline callbacks into their enclosing function in all walkers
 * - 4 added DS coverage, which the baseline now stores beside its complexity map
 * - 5 moved the DS package patterns from the eval fixture to the external-repo pin,
 *     so a baseline whose fixture was missing no longer stores a null coverage
 * - 6 taught the census subpath DS patterns, `styled('div')`, and context providers
 */
export const postAnalysis: PostAnalysis = {
	analyzeRun,
	deltaToBaseline,
	summarize,
	metricsVersion: 6,
};
