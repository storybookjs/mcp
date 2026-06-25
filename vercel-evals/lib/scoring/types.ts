import type { EvalRunData } from '@vercel/agent-eval';
import type { AgentRunAnalysis } from '../agent-analysis';

export type ScoringContext = {
	fixtureName: string;
	runData: EvalRunData;
	analysis: AgentRunAnalysis;
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
