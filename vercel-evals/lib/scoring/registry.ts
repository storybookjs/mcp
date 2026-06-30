import type {
	EvaluationScore,
	EvaluationScorer,
	ScoringAnalysis,
	ScoringContext,
	ScoringRunData,
} from './types.ts';

export const scoringRegistry: EvaluationScorer[] = [];

export function findScorer(fixtureName: string): EvaluationScorer | undefined {
	return scoringRegistry.find((scorer) => scorer.fixtureName === fixtureName);
}

export function scoreContext(context: ScoringContext): EvaluationScore | undefined {
	return findScorer(context.fixtureName)?.score(context);
}

export function scoreEvaluation(
	fixtureName: string,
	runData: ScoringRunData,
	analysis: ScoringAnalysis,
	agent: string,
): EvaluationScore | undefined {
	return scoreContext({ fixtureName, runData, analysis, agent });
}

/** Default pass bar (percent) for a fixture, from its scorer definition. */
export function defaultThreshold(fixtureName: string): number | undefined {
	return findScorer(fixtureName)?.threshold;
}

/**
 * Pass bar (percent) the fixture's MEAN score must clear. Single source of truth
 * for both `onRunComplete` (logging) and `export-results` (the gate):
 * `EVAL_SCORE_THRESHOLD` overrides the scorer's default for a run.
 */
export function scoreThreshold(fixtureName: string): number {
	const raw = process.env.EVAL_SCORE_THRESHOLD;
	if (raw !== undefined && raw.trim() !== '') {
		const value = Number(raw);
		if (!Number.isFinite(value) || value < 0 || value > 100) {
			throw new Error(`Invalid EVAL_SCORE_THRESHOLD: "${raw}" (expected a number 0–100)`);
		}
		return value;
	}

	return defaultThreshold(fixtureName) ?? 100;
}
