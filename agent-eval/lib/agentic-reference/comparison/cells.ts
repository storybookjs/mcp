import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseTimestamp, type Run } from '../../post-analysis/runs.ts';
import { isCurrentCacheEntry, readCacheEntry } from '../../post-analysis/run-cache.ts';
import { readJson } from '../../utils/files.ts';
import type { ResolvedCase } from './resolve.ts';

export type ExclusionReason = 'infra-failure' | 'malformed-analysis';
export type GapReason = 'missing-runs' | 'unanalyzed' | 'stale-analysis';

export interface ExcludedRun {
	runDir: string;
	reason: ExclusionReason;
}

export interface UsableRun {
	run: Run;
	analysis: Record<string, unknown>;
}

export interface Cell {
	case: ResolvedCase;
	workflow: string;
	/** Selected timestamp, or 'all' when pooling batches. */
	batch: string;
	runs: UsableRun[];
	excluded: ExcludedRun[];
	unanalyzed: number;
	stale: number;
	passed: number;
	failed: number;
}

export interface CellGap {
	case: ResolvedCase;
	workflow: string;
	have: number;
	need: number;
	reason: GapReason;
}

interface BuildOptions {
	runs: Run[];
	cases: ResolvedCase[];
	workflows: string[];
	minRuns: number;
	allBatches: boolean;
	metricsVersion: number | undefined;
}

function classify(run: Run, metricsVersion: number | undefined, cell: Cell) {
	const result = readJson<{ status?: string }>(join(run.runDir, 'result.json'));
	if (result?.status === 'passed') cell.passed += 1;
	else if (result?.status === 'failed') cell.failed += 1;
	const analysisPath = join(run.runDir, 'analysis.json');
	if (!existsSync(analysisPath)) {
		if (result?.status === 'failed') {
			cell.excluded.push({ runDir: run.runDir, reason: 'infra-failure' });
		} else {
			cell.unanalyzed += 1;
		}
		return;
	}
	const analysis = readJson<Record<string, unknown>>(analysisPath);
	if (analysis === null) {
		cell.excluded.push({ runDir: run.runDir, reason: 'malformed-analysis' });
		return;
	}
	if (!isCurrentCacheEntry(readCacheEntry(run.runDir), metricsVersion)) {
		cell.stale += 1;
		return;
	}
	cell.runs.push({ run, analysis });
}

export function buildCells(options: BuildOptions): { cells: Cell[]; gaps: CellGap[] } {
	const cells: Cell[] = [];
	const gaps: CellGap[] = [];
	for (const resolvedCase of options.cases) {
		for (const workflow of options.workflows) {
			const candidates = options.runs.filter(
				(run) => run.experiment === resolvedCase.experiment && run.evalName === workflow,
			);
			const batches = [...new Set(candidates.map((run) => run.timestamp))].sort(
				(a, b) => parseTimestamp(a) - parseTimestamp(b),
			);
			const batch = options.allBatches ? 'all' : (batches.at(-1) ?? 'none');
			const selected = options.allBatches
				? candidates
				: candidates.filter((run) => run.timestamp === batch);
			const cell: Cell = {
				case: resolvedCase,
				workflow,
				batch,
				runs: [],
				excluded: [],
				unanalyzed: 0,
				stale: 0,
				passed: 0,
				failed: 0,
			};
			for (const run of selected.sort((a, b) => a.run - b.run)) {
				classify(run, options.metricsVersion, cell);
			}
			cells.push(cell);
			if (cell.runs.length < options.minRuns) {
				const shortfall = options.minRuns - cell.runs.length;
				const reason: GapReason =
					cell.stale >= shortfall
						? 'stale-analysis'
						: cell.unanalyzed >= shortfall
							? 'unanalyzed'
							: cell.stale + cell.unanalyzed >= shortfall
								? 'stale-analysis'
								: 'missing-runs';
				gaps.push({
					case: resolvedCase,
					workflow,
					have: cell.runs.length,
					need: options.minRuns,
					reason,
				});
			}
		}
	}
	return { cells, gaps };
}

/** Strict intersection: keep candidates where every case meets the gate. */
export function autoSelectWorkflows(
	options: Omit<BuildOptions, 'workflows'> & { candidates: string[] },
) {
	const { candidates, ...rest } = options;
	const selected: string[] = [];
	const skipped: { workflow: string; gaps: CellGap[] }[] = [];
	for (const workflow of candidates) {
		const { gaps } = buildCells({ ...rest, workflows: [workflow] });
		if (gaps.length === 0) selected.push(workflow);
		else skipped.push({ workflow, gaps });
	}
	return { selected, skipped };
}
