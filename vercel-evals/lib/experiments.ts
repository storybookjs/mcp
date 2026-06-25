import type { EvalRunData, ExperimentConfig } from '@vercel/agent-eval';
import { analyzeAgentRun } from './agent-analysis.js';

export const CLAUDE_STORYBOOK_PLUGIN_EVALS = [
  '922-skill-storybook-setup-claude-launch',
  '923-skill-stories',
] as const;

export const CODEX_STORYBOOK_PLUGIN_EVALS = ['923-skill-stories'] as const;

export function withAgentAnalysis(config: ExperimentConfig): ExperimentConfig {
  return {
    ...config,
    async onRunComplete(context): Promise<EvalRunData> {
      const result = await config.onRunComplete?.(context);
      const runData = result ?? context.runData;
      const agent = analyzeAgentRun(runData, context.config.agent);

      return {
        ...runData,
        result: {
          ...runData.result,
          analysis: {
            ...(runData.result.analysis ?? {}),
            agent,
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
