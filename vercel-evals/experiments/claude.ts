import type { ExperimentConfig } from '@vercel/agent-eval';
import { CLAUDE_STORYBOOK_PLUGIN_EVALS, evalRuns, withAgentAnalysis } from '../lib/experiments.ts';
import { storybookPreviewBrowserMockFiles, storybookSkillFiles } from '../lib/skills-fixture.ts';

const config: ExperimentConfig = withAgentAnalysis({
	agent: 'vercel-ai-gateway/claude-code',
	evals: [...CLAUDE_STORYBOOK_PLUGIN_EVALS],
	runs: evalRuns(),
	sandbox: 'docker',
	earlyExit: true,
	scripts: ['build'],
	timeout: 900,
	copyFiles: 'changed',
	setup: async (sandbox) => {
		await sandbox.writeFiles({
			...storybookSkillFiles(),
			...storybookPreviewBrowserMockFiles(),
		});
	},
});

export default config;
