// The ds-misuse metric: how well a run used the design system.
//
// ds-coverage answers how *much* of a run's UI came from the design system.
// This answers whether the agent chose well — right component, used the way the
// guidelines say, and local only where nothing in the system fit.
//
// It is the one metric in this tree that is not a pure function of stored
// artifacts: it calls a model, so it lives behind its own CLI rather than in
// post-analysis, and its result is cached on disk as ds-misuse.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from '../../../utils/files.ts';
import { analyzeDsCoverage } from '../ds-coverage/index.ts';
import { buildJudgeRequest, JUDGE_MODEL } from './context.ts';
import { collectDsDocs, dsDocsRefLabel } from './ds-docs.ts';
import { runJudge } from './judge.ts';
import { summariseJudgement } from './score.ts';
import { treePatch } from './tree-patch.ts';
import { DS_MISUSE_SCHEMA_VERSION } from './types.ts';

import type { NodeRecord } from '../ds-coverage/types.ts';
import type { DsMisuseReport } from './types.ts';

export const DS_MISUSE_FILENAME = 'ds-misuse.json';

export interface JudgeRunInput {
	/** The run directory; the artifact lands here. */
	runDir: string;
	/** The collected post-run tree. */
	projectDir: string;
	/** The materialized pinned tree the run started from. */
	baselineDir: string;
	/** Whole-tree node census of the pinned tree, from the sidecar. */
	baselineNodes: NodeRecord[];
	/** DS package patterns for this pin. */
	dsPackages: string[];
	/** `repo@ref` of the pin, recorded in the artifact. */
	fixtureRef: string;
	metricsVersion: number | undefined;
	/** Where prepareRef caches trees. */
	refCacheDir: string;
}

export interface StalenessCheck {
	dsGuidelinesRef: string;
	metricsVersion: number | undefined;
}

export function readMisuseReport(runDir: string): DsMisuseReport | null {
	return readJson<DsMisuseReport>(join(runDir, DS_MISUSE_FILENAME));
}

export function writeMisuseReport(runDir: string, report: DsMisuseReport): void {
	writeFileSync(join(runDir, DS_MISUSE_FILENAME), JSON.stringify(report, null, 2) + '\n');
}

/**
 * Whether a stored judgement can still be trusted.
 *
 * A moved guidelines pin means the run was scored against a different standard;
 * a moved metricsVersion means its node paths were built by different rules.
 * Either way the number is not comparable with a fresh one, so it is re-spent.
 */
export function isStale(report: DsMisuseReport, current: StalenessCheck): boolean {
	return (
		report.schemaVersion !== DS_MISUSE_SCHEMA_VERSION ||
		report.dsGuidelinesRef !== current.dsGuidelinesRef ||
		report.metricsVersion !== current.metricsVersion
	);
}

/** A run to look for an artifact beside, and the rules to judge it against. */
export interface MisuseReportRequest {
	runDir: string;
	/** The metricsVersion of the module that measured *this* run. */
	metricsVersion: number | undefined;
}

export interface UsableMisuseReports {
	/** One entry per requested run; null where there is nothing usable. */
	byRunDir: Map<string, DsMisuseReport | null>;
	/** Judged, but against a standard that has since moved. */
	stale: number;
	/** Never judged at all. */
	absent: number;
}

/**
 * Every run's usable artifact, read once.
 *
 * Once, because a caller printing tables wants it several times over and the
 * file carries one record per judged JSX node.
 *
 * Usable, because a stale artifact is worse than none to a reader. It was
 * scored against a different guidelines pin, judge model, or set of node-path
 * rules, so putting it in a column beside a fresh score files two different
 * measurements under one heading — and comparing arms is the whole point of the
 * metric. The two reasons are counted apart so a caller can tell "never judged"
 * from "judged, then the standard moved".
 */
export function readUsableMisuseReports(runs: readonly MisuseReportRequest[]): UsableMisuseReports {
	const dsGuidelinesRef = dsDocsRefLabel();
	const byRunDir = new Map<string, DsMisuseReport | null>();
	let stale = 0;
	let absent = 0;

	for (const run of runs) {
		const report = readMisuseReport(run.runDir);
		if (report === null) {
			absent += 1;
			byRunDir.set(run.runDir, null);
			continue;
		}
		if (isStale(report, { dsGuidelinesRef, metricsVersion: run.metricsVersion })) {
			stale += 1;
			byRunDir.set(run.runDir, null);
			continue;
		}
		byRunDir.set(run.runDir, report);
	}

	return { byRunDir, stale, absent };
}

/** Judge one run and return its report. Makes exactly one model call. */
export async function judgeRun(input: JudgeRunInput): Promise<DsMisuseReport> {
	const patch = treePatch(input.baselineDir, input.projectDir);

	// Targeted: the graph is still whole so imports resolve, but only the files
	// the run touched are counted — a new JSX node can appear nowhere else.
	const treatment = analyzeDsCoverage({
		projectDir: input.projectDir,
		dsPackages: input.dsPackages,
		includeNodes: true,
		censusInclude: patch.files,
	});

	const judged = await runJudge(
		buildJudgeRequest({
			docs: collectDsDocs(input.refCacheDir),
			baselineNodes: input.baselineNodes,
			treatmentNodes: treatment.nodeList ?? [],
			patch,
			fixtureRef: input.fixtureRef,
		}),
	);

	return {
		schemaVersion: DS_MISUSE_SCHEMA_VERSION,
		metricsVersion: input.metricsVersion,
		judgedAt: new Date().toISOString(),
		model: JUDGE_MODEL,
		dsGuidelinesRef: dsDocsRefLabel(),
		fixtureRef: input.fixtureRef,
		diffTruncated: patch.truncated,
		summary: summariseJudgement(judged.nodes),
		// The buckets travel with the scores: the judge chose them, so a surprising
		// number has to be traceable to what it actually counted.
		nodes: judged.nodes,
	};
}
