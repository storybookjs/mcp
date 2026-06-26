import type { ExperimentConfig } from '@vercel/agent-eval';
import { CODEX_STORYBOOK_PLUGIN_EVALS, withAgentAnalysis } from '../lib/experiments.ts';
import { storybookPreviewBrowserMockFiles, storybookSkillFiles } from '../lib/skills-fixture.ts';

const config: ExperimentConfig = withAgentAnalysis({
	agent: 'vercel-ai-gateway/codex',
	evals: [...CODEX_STORYBOOK_PLUGIN_EVALS],
	runs: 1,
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
