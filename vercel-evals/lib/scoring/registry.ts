import { storybookSetupClaudeLaunchScorer } from './scorers/storybook-setup-claude-launch.ts';
import { storiesScorer } from './scorers/stories.ts';
import type {
	EvaluationScore,
	EvaluationScorer,
	ScoringAnalysis,
	ScoringContext,
	ScoringRunData,
} from './types.ts';

export const scoringRegistry: EvaluationScorer[] = [
	storybookSetupClaudeLaunchScorer,
	storiesScorer,
];

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
