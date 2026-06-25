import type { EvalRunData, ExperimentConfig } from '@vercel/agent-eval';
import { analyzeAgentRun } from './agent-analysis.js';

export const STORYBOOK_PLUGIN_EVALS = [
  'ade-plugins',
  'ade-plugins-bare',
  'ade-plugins-stories-only',
] as const;

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
