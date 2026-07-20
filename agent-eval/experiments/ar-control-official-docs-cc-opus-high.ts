// Agentic reference (SB-1724) — control-official-docs case: curated
// base-ui.com docs available, no MCP (SB-1726). Runs zero evals unless
// EVAL_AGENTIC_REFERENCE=1; see agent-eval/lib/agentic-reference/config.ts
// and AGENTIC-REFERENCE.md.
import type { ExperimentConfig } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../lib/experiment.ts';
import {
	AR_RUNS,
	getActiveAgenticReferenceEvals,
	isAgenticReferenceEnabled,
} from '../lib/agentic-reference/config.ts';
import { getAgenticReferenceCase } from '../lib/agentic-reference/cases.ts';

const agenticReferenceCase = getAgenticReferenceCase('control-official-docs');

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
