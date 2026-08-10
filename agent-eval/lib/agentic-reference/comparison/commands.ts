import type { CellGap } from './cells.ts';

export function formatGapTable(gaps: CellGap[]): string {
	const rows = [
		['case', 'workflow', 'runs', 'reason'],
		...gaps.map((gap) => [gap.case.shortName, gap.workflow, `${gap.have}/${gap.need}`, gap.reason]),
	];
	const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
	return rows
		.map((row) =>
			row
				.map((value, col) => value.padEnd(widths[col]!))
				.join('  ')
				.trimEnd(),
		)
		.join('\n');
}

export function remediationCommands(gaps: CellGap[]): string[] {
	const collect = new Map<string, { workflows: Set<string>; need: number }>();
	const analyze = new Set<string>();
	const recompute = new Set<string>();
	for (const gap of gaps) {
		const experiment = gap.case.experiment;
		if (gap.reason === 'missing-runs') {
			const entry = collect.get(experiment) ?? { workflows: new Set(), need: 0 };
			entry.workflows.add(gap.workflow);
			entry.need = Math.max(entry.need, gap.need);
			collect.set(experiment, entry);
		} else if (gap.reason === 'unanalyzed') {
			analyze.add(experiment);
		} else {
			recompute.add(experiment);
		}
	}
	return [
		...[...collect.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([experiment, { workflows, need }]) =>
					`AGENTIC_REF_FLOW=${[...workflows].sort().join(',')} AGENTIC_REF_RUNS=${need} pnpm eval:agentic-ref ${experiment}`,
			),
		...[...analyze].sort().map((e) => `pnpm results:analyze --experiment=${e}`),
		...[...recompute].sort().map((e) => `pnpm results:analyze --recompute --experiment=${e}`),
	];
}
