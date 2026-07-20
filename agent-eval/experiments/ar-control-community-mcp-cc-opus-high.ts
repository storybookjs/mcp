// Agentic reference (SB-1724) — control-community-mcp case: a community Base
// UI MCP/skill, to be identified (SB-1682). The case's setup always throws
// (no candidate identified yet), so this additionally requires
// AR_COMMUNITY_MCP=1 on top of EVAL_AGENTIC_REFERENCE=1 before it lists any
// evals — belt-and-suspenders so it can never run by accident. See
// agent-eval/lib/agentic-reference/config.ts and AGENTIC-REFERENCE.md.
import type { ExperimentConfig } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../lib/experiment.ts';
import {
	AR_RUNS,
	getActiveAgenticReferenceEvals,
	isAgenticReferenceEnabled,
	isCommunityMcpEnabled,
} from '../lib/agentic-reference/config.ts';
import { getAgenticReferenceCase } from '../lib/agentic-reference/cases.ts';

const agenticReferenceCase = getAgenticReferenceCase('control-community-mcp');

export default {
	...DEFAULT_EXPERIMENT_CONFIG,
	agent: 'claude-code', // direct Anthropic API, requires ANTHROPIC_API_KEY
	model: 'opus',
	agentOptions: { effort: 'high' },
	runs: AR_RUNS,
	// See ar-control-empty-cc-opus-high.ts: 705's real `yarn install` needs
	// more room than the shared 900s default.
	timeout: 1800,
	evals:
		isAgenticReferenceEnabled() && isCommunityMcpEnabled()
			? [...getActiveAgenticReferenceEvals()]
			: [],
	setup: agenticReferenceCase.setup,
} satisfies ExperimentConfig;
