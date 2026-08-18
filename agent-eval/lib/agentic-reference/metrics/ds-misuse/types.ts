// What the judge returns, and the schema that guarantees it.
//
// The schema is handed to the Messages API as output_config.format, so the model
// cannot return a shape this file does not describe. That is why there is no
// defensive parsing anywhere downstream.

/** Bump when the artifact's shape changes in a way a reader must notice. */
export const DS_MISUSE_SCHEMA_VERSION = 1;

/** 1 right, 0.5 ambiguous or debatable, 0 wrong. */
export type JudgeScore = 0 | 0.5 | 1;

export interface ScoredAnswer {
	score: JudgeScore;
	/** Why. A bare number is not reviewable, and this is the first thing anyone asks. */
	reason: string;
}

/** Where a judged node is, whichever kind it turned out to be. */
interface JudgedNodeIdentity {
	path: string;
	file: string;
	line: number;
	tag: string;
}

/** A node the run took from the design system. Both DS questions are answered. */
export interface JudgedDsNode extends JudgedNodeIdentity {
	kind: 'ds';
	correctDsDecision: ScoredAnswer;
	correctDsUsage: ScoredAnswer;
}

/** A node the run wrote itself. Only the local question applies. */
export interface JudgedLocalNode extends JudgedNodeIdentity {
	kind: 'local';
	correctLocalDecision: ScoredAnswer;
}

/**
 * Discriminated on `kind`, mirroring JUDGE_OUTPUT_SCHEMA: which questions a node
 * carries is decided by which kind it is, never by which keys happen to be
 * present. Optional score groups let a `ds` node arrive with no DS scores at
 * all, or with a local one, and a summary averaging by key presence would count
 * it either way.
 */
export type JudgedNode = JudgedDsNode | JudgedLocalNode;

/** Exactly what the model is constrained to return. */
export interface JudgeResponse {
	nodes: JudgedNode[];
}

/**
 * What one judge call cost, in the four token classes that are priced
 * differently.
 */
export interface JudgeUsage {
	input: number;
	cacheWrite: number;
	cacheRead: number;
	output: number;
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
  /** Helps understand the cost structure of the LLM judge. */
	usage?: JudgeUsage;
	summary: DsMisuseSummary;
	nodes: JudgedNode[];
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

const NODE_IDENTITY = {
	path: { type: 'string' },
	file: { type: 'string' },
	line: { type: 'integer' },
	tag: { type: 'string' },
} as const;

const IDENTITY_REQUIRED = ['path', 'file', 'line', 'tag'] as const;

/** A DS usage: both DS questions required, and the local one not offered. */
const DS_NODE_SCHEMA = {
	type: 'object',
	properties: {
		...NODE_IDENTITY,
		kind: { type: 'string', enum: ['ds'] },
		correctDsDecision: SCORED_ANSWER,
		correctDsUsage: SCORED_ANSWER,
	},
	required: [...IDENTITY_REQUIRED, 'kind', 'correctDsDecision', 'correctDsUsage'],
	additionalProperties: false,
} as const;

/** A local usage: the local question required, and neither DS one offered. */
const LOCAL_NODE_SCHEMA = {
	type: 'object',
	properties: {
		...NODE_IDENTITY,
		kind: { type: 'string', enum: ['local'] },
		correctLocalDecision: SCORED_ANSWER,
	},
	required: [...IDENTITY_REQUIRED, 'kind', 'correctLocalDecision'],
	additionalProperties: false,
} as const;

/**
 * The JSON schema handed to output_config.format.
 *
 * Written out rather than generated: `additionalProperties: false` is required
 * on every object and recursion is unsupported.
 *
 * The two kinds are separate `anyOf` variants rather than one object with
 * optional score groups. Optional groups made the schema accept a `ds` node
 * carrying no DS scores — which summariseJudgement counted as evaluated while
 * returning null means — and a `local` node carrying a `correctDsDecision`,
 * which landed in the DS mean. Each variant pins `kind` to a single value and
 * requires exactly the questions that kind is asked, so the wrong shape is
 * rejected by the API rather than averaged by us.
 *
 * `anyOf` and not `if`/`then`/`else`: the conditional keywords are not part of
 * the schema subset structured outputs supports.
 */
export const JUDGE_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		nodes: {
			type: 'array',
			items: { anyOf: [DS_NODE_SCHEMA, LOCAL_NODE_SCHEMA] },
		},
	},
	required: ['nodes'],
	additionalProperties: false,
} as const;
