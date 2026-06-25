import type { EvalRunData, ExperimentConfig } from '@vercel/agent-eval';
import { analyzeAgentRun } from './agent-analysis';
import { scoreEvaluation } from './evaluation-scoring';

export const CLAUDE_STORYBOOK_PLUGIN_EVALS = [
	'922-skill-storybook-setup-claude-launch',
	'923-skill-stories',
] as const;

export const CODEX_STORYBOOK_PLUGIN_EVALS = ['923-skill-stories'] as const;

function logEvaluation(fixtureName: string, evaluation: ReturnType<typeof scoreEvaluation>): void {
	if (!evaluation) return;

	const items = evaluation.items
		.map((item) => `${item.id}=${Math.round(item.score * 100)}%`)
		.join(', ');

	process.stderr.write(`[agent-eval] ${fixtureName} score=${evaluation.percent}% (${items})\n`);
}

export function withAgentAnalysis(config: ExperimentConfig): ExperimentConfig {
	return {
		...config,
		async onRunComplete(context): Promise<EvalRunData> {
			const result = await config.onRunComplete?.(context);
			const runData = result ?? context.runData;
			const agent = analyzeAgentRun(runData, context.config.agent);
			const evaluation = scoreEvaluation(
				context.fixture.name,
				runData,
				agent,
				context.config.agent,
			);
			logEvaluation(context.fixture.name, evaluation);

			return {
				...runData,
				result: {
					...runData.result,
					analysis: {
						...(runData.result.analysis ?? {}),
						agent,
						evaluation,
						skillInvocations: agent.skillInvocations,
					},
					metadata: {
						...(runData.result.metadata ?? {}),
						evalFixture: context.fixture.name,
					},
				},
			};
		},
	};
}
