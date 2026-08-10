import { relative, sep } from 'node:path';

import { metricValueAt, type ComparisonMetric } from '../comparison-metrics.ts';
import type { Cell } from './cells.ts';
import type { ResolvedCase } from './resolve.ts';

export interface ComparisonSpec {
	control: ResolvedCase;
	treatments: ResolvedCase[];
	workflows: string[];
	mode: 'single-workflow' | 'aggregate';
	minRuns: number;
	allBatches: boolean;
}

function orderedCells(cells: Cell[], spec: ComparisonSpec): Cell[] {
	const caseRank = (c: ResolvedCase) => (c.caseName === spec.control.caseName ? '' : c.caseName);
	return [...cells].sort(
		(a, b) =>
			caseRank(a.case).localeCompare(caseRank(b.case)) ||
			a.workflow.localeCompare(b.workflow) ||
			a.batch.localeCompare(b.batch),
	);
}

export function datasetCsv(
	cells: Cell[],
	metrics: ComparisonMetric[],
	spec: ComparisonSpec,
): string {
	const header = ['case', 'workflow', 'batch', 'run', ...metrics.map((m) => m.key)];
	const lines = [header.join(',')];
	for (const cell of orderedCells(cells, spec)) {
		for (const usable of [...cell.runs].sort(
			(a, b) => a.run.timestamp.localeCompare(b.run.timestamp) || a.run.run - b.run.run,
		)) {
			const values = metrics.map((metric) => {
				const value = metricValueAt(usable.analysis, metric.path);
				return value === null ? '' : String(value);
			});
			lines.push(
				[
					cell.case.shortName,
					cell.workflow,
					usable.run.timestamp,
					String(usable.run.run),
					...values,
				].join(','),
			);
		}
	}
	return lines.join('\n') + '\n';
}

function toPosix(path: string): string {
	return path.split(sep).join('/');
}

export function manifestJson(args: {
	spec: ComparisonSpec;
	metrics: ComparisonMetric[];
	cells: Cell[];
	agentEvalRoot: string;
	provenance: Record<string, unknown>;
}): string {
	const { spec, metrics, cells, agentEvalRoot, provenance } = args;
	const ordered = orderedCells(cells, spec);
	const manifest = {
		spec: {
			control: spec.control,
			treatments: spec.treatments,
			workflows: spec.workflows,
			mode: spec.mode,
			minRuns: spec.minRuns,
			allBatches: spec.allBatches,
		},
		metrics,
		// The BH family: every headline test of this invocation, in test order.
		family: metrics.flatMap((metric) =>
			spec.treatments.map((treatment) => ({ metric: metric.key, treatment: treatment.shortName })),
		),
		cells: ordered.map((cell) => ({
			case: cell.case.shortName,
			workflow: cell.workflow,
			batch: cell.batch,
			usableRuns: cell.runs.length,
			passed: cell.passed,
			failed: cell.failed,
			unanalyzed: cell.unanalyzed,
			stale: cell.stale,
		})),
		excludedRuns: ordered.flatMap((cell) =>
			cell.excluded.map((excluded) => ({
				path: toPosix(relative(agentEvalRoot, excluded.runDir)),
				reason: excluded.reason,
			})),
		),
		provenance,
	};
	return JSON.stringify(manifest, null, 2) + '\n';
}
