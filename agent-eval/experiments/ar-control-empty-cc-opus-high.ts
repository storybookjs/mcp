// Agentic reference (SB-1724) — control-empty case: no docs, no MCP, code
// only (SB-1726). Runs zero evals unless EVAL_AGENTIC_REFERENCE=1; see
// agent-eval/lib/agentic-reference/config.ts and AGENTIC-REFERENCE.md.
import type { ExperimentConfig } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../lib/experiment.ts';
import {
	AR_RUNS,
	getActiveAgenticReferenceEvals,
	isAgenticReferenceEnabled,
} from '../lib/agentic-reference/config.ts';
import { getAgenticReferenceCase } from '../lib/agentic-reference/cases.ts';

const agenticReferenceCase = getAgenticReferenceCase('control-empty');

export default {
	...DEFAULT_EXPERIMENT_CONFIG,
	agent: 'claude-code', // direct Anthropic API, requires ANTHROPIC_API_KEY
	model: 'opus',
	agentOptions: { effort: 'high' },
	runs: AR_RUNS,
	// 705-ar-mealdrop-example's `yarn install` against the real Mealdrop app is
	// heavier than the vite-app placeholder; the shared 900s default (see
	// lib/experiment.ts) is tight for that plus an opus-high agent run.
	timeout: 1800,
	evals: isAgenticReferenceEnabled() ? [...getActiveAgenticReferenceEvals()] : [],
	setup: agenticReferenceCase.setup,
} satisfies ExperimentConfig;
