// This module is injected into the eval sandbox (see lib/scoring-fixture.ts) so
// EVAL.ts can compute the score in-sandbox. It must stay self-contained: only
// Node builtins, no `@vercel/agent-eval` or `../agent-analysis` imports.
//
// The host passes its richer EvalRunData / AgentRunAnalysis objects, which
// structurally satisfy these minimal shapes, so the scoring logic is shared
// between the host (onRunComplete) and the sandbox (EVAL.ts).

export type ScoringRunData = {
	generatedFiles?: Record<string, string>;
};

export type ScoringAnalysis = {
	skillInvocations: string[];
	workflow: {
		browserUrls: string[];
		shellCommands: string[];
	};
};

export type ScoringContext = {
	fixtureName: string;
	runData: ScoringRunData;
	analysis: ScoringAnalysis;
	agent: string;
};

export type EvaluationScoreItem = {
	id: string;
	description: string;
	weight: number;
	score: number;
	details?: Record<string, unknown>;
};

export type EvaluationScore = {
	score: number;
	maxScore: number;
	percent: number;
	items: EvaluationScoreItem[];
};

export type EvaluationScorer = {
	fixtureName: string;
	/** Default pass bar for this eval, as a percent (0–100). Configurable per eval. */
	threshold: number;
	score: (context: ScoringContext) => EvaluationScore | undefined;
};

export function defineScorer<const T extends EvaluationScorer>(scorer: T): T {
	return scorer;
}

export function clampScore(score: number): number {
	return Math.max(0, Math.min(1, score));
}

export function binaryItem(
	id: string,
	description: string,
	weight: number,
	passed: boolean,
	details?: Record<string, unknown>,
): EvaluationScoreItem {
	return {
		id,
		description,
		weight,
		score: passed ? 1 : 0,
		...(details ? { details } : {}),
	};
}

export function totalScore(items: EvaluationScoreItem[]): EvaluationScore {
	const maxScore = items.reduce((sum, item) => sum + item.weight, 0);
	const score = items.reduce((sum, item) => sum + item.weight * clampScore(item.score), 0);

	return {
		score,
		maxScore,
		percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
		items,
	};
}
