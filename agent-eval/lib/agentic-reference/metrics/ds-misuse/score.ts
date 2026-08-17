// Folding a judgement into the numbers that reach a comparison table.
import { mean, round } from '../../../utils/math.ts';

import type { DsMisuseSummary, JudgedNode } from './types.ts';

/** Four decimals, matching coverage.ts: a mean rounded to two flattens a small move. */
const SCORE_DIGITS = 4;

function meanOf<T>(nodes: T[], read: (node: T) => number): number | null {
	return round(mean(nodes.map(read)), SCORE_DIGITS);
}

/**
 * Each score is a mean over the nodes that received it, or null when none did.
 *
 * null rather than 0 throughout: a run that created no local components has not
 * scored zero on local decisions, and a stored 0 would drag every later mean.
 *
 * Partitioned on `kind` rather than on which score keys a node happens to carry,
 * so the means and the `evaluated` counts beside them can never describe
 * different sets of nodes. The schema guarantees each partition's nodes carry
 * their kind's answers, which is why nothing here is optional.
 */
export function summariseJudgement(nodes: JudgedNode[]): DsMisuseSummary {
	const ds = nodes.filter((node) => node.kind === 'ds');
	const local = nodes.filter((node) => node.kind === 'local');

	return {
		correctDsDecision: meanOf(ds, (node) => node.correctDsDecision.score),
		correctDsUsage: meanOf(ds, (node) => node.correctDsUsage.score),
		correctLocalDecision: meanOf(local, (node) => node.correctLocalDecision.score),
		evaluated: { ds: ds.length, local: local.length },
	};
}
