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
