// What the judge returns, and the schema that guarantees it.
//
// The schema is handed to the Messages API as output_config.format, so the model
// cannot return a shape this file does not describe. That is why there is no
// defensive parsing anywhere downstream.
import type { NodeRecord } from '../ds-coverage/types.ts';

/** Bump when the artifact's shape changes in a way a reader must notice. */
export const DS_MISUSE_SCHEMA_VERSION = 1;

/** 1 right, 0.5 ambiguous or debatable, 0 wrong. */
export type JudgeScore = 0 | 0.5 | 1;

export interface ScoredAnswer {
	score: JudgeScore;
	/** Why. A bare number is not reviewable, and this is the first thing anyone asks. */
	reason: string;
}

export interface JudgedNode {
	path: string;
	file: string;
	line: number;
	tag: string;
	kind: 'ds' | 'local';
	/** DS nodes only. */
	correctDsDecision?: ScoredAnswer;
	/** DS nodes only. */
	correctDsUsage?: ScoredAnswer;
	/** Local nodes only. */
	correctLocalDecision?: ScoredAnswer;
}

/** Exactly what the model is constrained to return. */
export interface JudgeResponse {
	nodes: JudgedNode[];
}

export interface DsMisuseSummary {
	/** Mean over DS nodes, or null when none were evaluated. */
	correctDsDecision: number | null;
	correctDsUsage: number | null;
	/** Mean over local nodes, or null when none were evaluated. */
	correctLocalDecision: number | null;
	evaluated: { ds: number; local: number };
}

export interface DsMisuseReport {
	schemaVersion: number;
	/** The metricsVersion the node census was built under. */
	metricsVersion: number | undefined;
	judgedAt: string;
	model: string;
	/** `repo@sha` of the guidelines. A moved pin invalidates this artifact. */
	dsGuidelinesRef: string;
	/** `repo@ref` of the tree the run worked on. */
	fixtureRef: string;
	diffTruncated: boolean;
	summary: DsMisuseSummary;
	nodes: JudgedNode[];
}

/** What the judge is given about one side of the comparison. */
export interface NodeCensus {
	nodes: NodeRecord[];
}

const SCORED_ANSWER = {
	type: 'object',
	properties: {
		score: { type: 'number', enum: [0, 0.5, 1] },
		reason: { type: 'string' },
	},
	required: ['score', 'reason'],
	additionalProperties: false,
} as const;

/**
 * The JSON schema handed to output_config.format.
 *
 * Written out rather than generated: `additionalProperties: false` is required
 * on every object, recursion is unsupported, and the two per-kind score groups
 * are deliberately optional rather than nullable — a local node has no
 * correct-ds-decision to give, and a null there would read as a zero.
 */
export const JUDGE_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		nodes: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					file: { type: 'string' },
					line: { type: 'integer' },
					tag: { type: 'string' },
					kind: { type: 'string', enum: ['ds', 'local'] },
					correctDsDecision: SCORED_ANSWER,
					correctDsUsage: SCORED_ANSWER,
					correctLocalDecision: SCORED_ANSWER,
				},
				required: ['path', 'file', 'line', 'tag', 'kind'],
				additionalProperties: false,
			},
		},
	},
	required: ['nodes'],
	additionalProperties: false,
} as const;
