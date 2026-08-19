import type { Cell, CellGap, CellReason } from './cells.ts';
import type { ResolvedCase } from './resolve.ts';
import { PLAIN_STYLE, type OutputStyle } from '../style.ts';

/** One table row: a cell's gap, or its complete state. */
export interface CellStatus {
	case: ResolvedCase;
	workflow: string;
	have: number;
	need: number;
	reason: CellReason;
}

/** Every cell as a table row, in cell order: its gap, or a complete line. */
export function cellStatuses(cells: Cell[], gaps: CellGap[], need: number): CellStatus[] {
	return cells.map(
		(cell) =>
			gaps.find(
				(gap) => gap.case.caseName === cell.case.caseName && gap.workflow === cell.workflow,
			) ?? {
				case: cell.case,
				workflow: cell.workflow,
				have: cell.runs.length,
				need,
				reason: 'complete',
			},
	);
}

export function formatCellTable(
	statuses: readonly CellStatus[],
	style: OutputStyle = PLAIN_STYLE,
): string {
	const rows = [
		['case', 'workflow', 'runs', 'reason'],
		...statuses.map((status) => [
			status.case.shortName,
			status.workflow,
			`${status.have}/${status.need}`,
			status.reason,
		]),
	];
	const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
	// Column widths are computed from plain text above; styling is applied
	// only after padding, so ANSI escapes never inflate `.length` and skew
	// alignment. The last column is never padded (nothing follows it on the
	// line), which is also what the original .trimEnd()-per-row behavior
	// amounted to — so no separate trim step is needed here.
	const lastCol = widths.length - 1;
	return rows
		.map((row, rowIndex) => {
			const padded = row.map((value, col) =>
				col === lastCol ? value : value.padEnd(widths[col]!),
			);
			if (rowIndex === 0) return padded.map((cell) => style.bold(cell)).join('  ');
			const status = statuses[rowIndex - 1]!;
			return padded
				.map((cell, col) => {
					if (col === 0) return style.caseName(cell);
					if (col === lastCol) return style.reason(status.reason, cell);
					return cell;
				})
				.join('  ');
		})
		.join('\n');
}

export function remediationCommands(gaps: CellGap[]): string[] {
	const collect = new Map<string, { workflows: Set<string>; need: number }>();
	const analyze = new Set<string>();
	for (const gap of gaps) {
		const experiment = gap.case.experiment;
		if (gap.reason === 'unanalyzed') {
			analyze.add(experiment);
		} else {
			// missing-runs and superseded-runs both mean data collection is necessary.
			const entry = collect.get(experiment) ?? { workflows: new Set(), need: 0 };
			entry.workflows.add(gap.workflow);
			entry.need = Math.max(entry.need, gap.need);
			collect.set(experiment, entry);
		}
	}
	// Freshly collected runs land unanalyzed, so every experiment earning a
	// collection command also needs an analyze follow-up.
	for (const experiment of collect.keys()) {
		analyze.add(experiment);
	}
	return [
		...[...collect.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([experiment, { workflows, need }]) =>
					`AGENTIC_REF_FLOW=${[...workflows].sort().join(',')} AGENTIC_REF_RUNS=${need} pnpm eval:agentic-ref ${experiment}`,
			),
		...[...analyze].sort().map((e) => `pnpm results:analyze --experiment=${e}`),
	];
}
