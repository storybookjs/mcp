import type { ExperimentConfig } from '@vercel/agent-eval';
import { CLAUDE_STORYBOOK_PLUGIN_EVALS, withAgentAnalysis } from '../lib/experiments.ts';
import {
	claudeMcpConfigFiles,
	storybookPreviewBrowserMockFiles,
	storybookSkillFiles,
} from '../lib/skills-fixture.ts';

const config: ExperimentConfig = withAgentAnalysis({
	agent: 'vercel-ai-gateway/claude-code',
	evals: [...CLAUDE_STORYBOOK_PLUGIN_EVALS],

	scripts: ['build'],
	timeout: 900,
	copyFiles: 'changed',
	setup: async (sandbox) => {
		await sandbox.writeFiles({
			...storybookSkillFiles(),
			...storybookPreviewBrowserMockFiles(),
			...claudeMcpConfigFiles(),
		});
	},
});

export default config;
