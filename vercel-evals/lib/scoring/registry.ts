import type { EvalRunData } from '@vercel/agent-eval';
import type { AgentRunAnalysis } from '../agent-analysis.ts';
import { storybookSetupClaudeLaunchScorer } from './scorers/storybook-setup-claude-launch.ts';
import { storiesScorer } from './scorers/stories.ts';
import type { EvaluationScore, EvaluationScorer, ScoringContext } from './types.ts';

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
	runData: EvalRunData,
	analysis: AgentRunAnalysis,
	agent: string,
): EvaluationScore | undefined {
	return scoreContext({ fixtureName, runData, analysis, agent });
}
