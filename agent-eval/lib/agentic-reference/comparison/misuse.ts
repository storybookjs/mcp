// Pooling per-run ds-misuse judgements into one panel for the report.
//
// The judge writes one ds-misuse.json per run (see ../metrics/ds-misuse), and
// nothing in the comparison pipeline reads it: the tables carry the means and
// the reasons stay on disk. This module inverts that — the reasons are the
// data, so the panel carries every below-perfect verdict verbatim, and the
// summary keeps whole distributions rather than collapsing to a mean a reader
// cannot interrogate.
//
// Judging is a separate, paid step, so partial coverage is the normal state of
// a bundle, not an error: the panel reports judged-vs-usable per cell and the
// report renders what exists.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readMisuseReport } from '../metrics/ds-misuse/index.ts';

import type { Cell } from './cells.ts';
import type { ComparisonSpec } from './emit.ts';
import type { JudgedNode } from '../metrics/ds-misuse/types.ts';

export const MISUSE_QUESTIONS = [
	'correctDsDecision',
	'correctDsUsage',
	'correctLocalDecision',
] as const;
export type MisuseQuestion = (typeof MISUSE_QUESTIONS)[number];

/** How many nodes landed on each of the three allowed scores. */
export interface ScoreDistribution {
	ones: number;
	halves: number;
	zeros: number;
}

export interface MisuseCellSummary {
	case: string;
	workflow: string;
	/** Runs the comparison counts for this cell. */
	usable: number;
	/** Of those, runs carrying a current ds-misuse.json. */
	judged: number;
	/** Pooled over every judged run's nodes; null when no node got the question. */
	questions: Record<MisuseQuestion, ScoreDistribution | null>;
	evaluated: { ds: number; local: number };
}

/** One below-perfect verdict, kept whole so the report can show the reason. */
export interface MisuseFinding {
	case: string;
	workflow: string;
	/** `<batch>/run-<n>`, matching how the CLI names runs. */
	runLabel: string;
	file: string;
	line: number;
	tag: string;
	kind: 'ds' | 'local';
	question: MisuseQuestion;
	score: 0 | 0.5;
	reason: string;
	/** The flagged source, read from the run's collected tree at build time. */
	excerpt?: { start: number; lines: string[] };
}

const EXCERPT_CONTEXT = 3;

/**
 * A few lines of the flagged source, so a finding can be read without opening
 * the run's tree. Free and retroactive: this reads the collected project on
 * disk, never the model, so it works for every judgement ever cached.
 */
function excerptOf(
	projectDir: string,
	file: string,
	line: number,
	cache: Map<string, string[] | null>,
): MisuseFinding['excerpt'] {
	let lines = cache.get(file);
	if (lines === undefined) {
		try {
			lines = readFileSync(join(projectDir, file), 'utf8').split('\n');
		} catch {
			lines = null;
		}
		cache.set(file, lines);
	}
	if (lines === null || line < 1 || line > lines.length) return undefined;
	const start = Math.max(1, line - EXCERPT_CONTEXT);
	return { start, lines: lines.slice(start - 1, Math.min(lines.length, line + EXCERPT_CONTEXT)) };
}

export interface MisusePanel {
	/** Distinct guideline pins seen across artifacts; more than one taints comparison. */
	guidelinesRefs: string[];
	judgedRuns: number;
	usableRuns: number;
	cells: MisuseCellSummary[];
	findings: MisuseFinding[];
}

function emptyDistribution(): ScoreDistribution {
	return { ones: 0, halves: 0, zeros: 0 };
}

function tally(distribution: ScoreDistribution, score: number): void {
	if (score === 1) distribution.ones += 1;
	else if (score === 0.5) distribution.halves += 1;
	else distribution.zeros += 1;
}

function poolNode(
	node: JudgedNode,
	questions: Record<MisuseQuestion, ScoreDistribution | null>,
	push: (question: MisuseQuestion, score: 0 | 0.5, reason: string) => void,
): void {
	for (const question of MISUSE_QUESTIONS) {
		const answer = node[question];
		if (answer === undefined) continue;
		questions[question] ??= emptyDistribution();
		tally(questions[question], answer.score);
		if (answer.score !== 1) push(question, answer.score, answer.reason);
	}
}

/**
 * Read every usable run's cached judgement and pool it per cell.
 *
 * Reads artifacts only — never the API — so it is free to run on every
 * comparison, judged or not. Cells keep the spec's own ordering upstream;
 * findings sort worst-first within a cell so the report needs no re-sort.
 */
export function collectMisusePanel(cells: Cell[], spec: ComparisonSpec): MisusePanel {
	const refs = new Set<string>();
	const summaries: MisuseCellSummary[] = [];
	const findings: MisuseFinding[] = [];
	let judgedRuns = 0;
	let usableRuns = 0;

	for (const cell of cells) {
		const shortName =
			cell.case.caseName === spec.control.caseName
				? spec.control.shortName
				: (spec.treatments.find((t) => t.caseName === cell.case.caseName)?.shortName ??
					cell.case.shortName);

		const summary: MisuseCellSummary = {
			case: shortName,
			workflow: cell.workflow,
			usable: cell.runs.length,
			judged: 0,
			questions: {
				correctDsDecision: null,
				correctDsUsage: null,
				correctLocalDecision: null,
			},
			evaluated: { ds: 0, local: 0 },
		};
		usableRuns += cell.runs.length;

		const cellFindings: MisuseFinding[] = [];
		for (const usable of cell.runs) {
			const report = readMisuseReport(usable.run.runDir);
			if (report === null) continue;
			summary.judged += 1;
			judgedRuns += 1;
			refs.add(report.dsGuidelinesRef);
			summary.evaluated.ds += report.summary.evaluated.ds;
			summary.evaluated.local += report.summary.evaluated.local;

			const runLabel = `${usable.run.timestamp}/run-${usable.run.run}`;
			const excerpts = new Map<string, string[] | null>();
			for (const node of report.nodes) {
				poolNode(node, summary.questions, (question, score, reason) => {
					cellFindings.push({
						case: shortName,
						workflow: cell.workflow,
						runLabel,
						file: node.file,
						line: node.line,
						tag: node.tag,
						kind: node.kind,
						question,
						score,
						reason,
						excerpt: excerptOf(usable.run.projectDir, node.file, node.line, excerpts),
					});
				});
			}
		}

		cellFindings.sort((a, b) => a.score - b.score || a.file.localeCompare(b.file));
		findings.push(...cellFindings);
		summaries.push(summary);
	}

	return {
		guidelinesRefs: [...refs].sort(),
		judgedRuns,
		usableRuns,
		cells: summaries,
		findings,
	};
}
