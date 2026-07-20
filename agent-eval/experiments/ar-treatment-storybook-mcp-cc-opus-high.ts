// Agentic reference (SB-1724) — treatment-storybook-mcp case: the Storybook
// MCP of a Base UI design-system Storybook we're building (SB-1725). Runs
// zero evals unless EVAL_AGENTIC_REFERENCE=1; see
// agent-eval/lib/agentic-reference/config.ts and AGENTIC-REFERENCE.md.
import type { ExperimentConfig } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../lib/experiment.ts';
import {
	AR_RUNS,
	getActiveAgenticReferenceEvals,
	isAgenticReferenceEnabled,
} from '../lib/agentic-reference/config.ts';
import { getAgenticReferenceCase } from '../lib/agentic-reference/cases.ts';

const agenticReferenceCase = getAgenticReferenceCase('treatment-storybook-mcp');

export default {
	...DEFAULT_EXPERIMENT_CONFIG,
	agent: 'claude-code', // direct Anthropic API, requires ANTHROPIC_API_KEY
	model: 'opus',
	agentOptions: { effort: 'high' },
	runs: AR_RUNS,
	// See ar-control-empty-cc-opus-high.ts: 705's real `yarn install` needs
	// more room than the shared 900s default.
	timeout: 1800,
	evals: isAgenticReferenceEnabled() ? [...getActiveAgenticReferenceEvals()] : [],
	setup: agenticReferenceCase.setup,
} satisfies ExperimentConfig;
