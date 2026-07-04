import type { ExperimentConfig } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG, EXTRA_MODEL_PLUGIN_EVALS } from '../lib/experiment.ts';
import {
	setupSandbox,
	writeCodexInAppBrowserMock,
	writeCodexPluginSkills,
} from '../lib/templates.ts';

export default {
	...DEFAULT_EXPERIMENT_CONFIG,
	// Keep Codex plugin and MCP experiments on the same direct Codex runner.
	// The MCP variant cannot use the AI Gateway path yet:
	// https://github.com/openai/codex/issues/26234
	agent: 'codex',
	model: 'gpt-5.4?reasoningEffort=medium',
	// Runs zero evals unless EVAL_EXTRA_MODELS=1 is set, and none under
	// EVAL_STORYBOOK_LATEST=1; see EXTRA_MODEL_PLUGIN_EVALS.
	evals: EXTRA_MODEL_PLUGIN_EVALS,
	setup: async (sandbox) => {
		await setupSandbox(sandbox, { agent: 'codex', integration: 'plugin' });
		await writeCodexPluginSkills(sandbox);
		await writeCodexInAppBrowserMock(sandbox);
	},
} satisfies ExperimentConfig;
