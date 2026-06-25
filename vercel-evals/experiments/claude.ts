import type { ExperimentConfig } from '@vercel/agent-eval';
import { CLAUDE_STORYBOOK_PLUGIN_EVALS, withAgentAnalysis } from '../lib/experiments';

const config: ExperimentConfig = withAgentAnalysis({
  agent: 'vercel-ai-gateway/claude-code',
  evals: [...CLAUDE_STORYBOOK_PLUGIN_EVALS],
  runs: 1,
  earlyExit: true,
  scripts: ['build'],
  timeout: 900,
  copyFiles: 'changed',
});

export default config;
