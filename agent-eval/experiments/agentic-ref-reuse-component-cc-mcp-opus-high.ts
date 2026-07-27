// Agentic-reference reuse-component experiment: Claude Code (opus, high effort)
// runs the 701 reuse-component task with an externally hosted design-system
// Storybook MCP; the eval asserts the agent consulted it. Runs nothing unless
// EVAL_AGENTIC_REFERENCE=1. Point a run at a different published MCP with
// AGENTIC_REF_STORYBOOK_MCP_URL, or add a sibling experiment pinning its own
// URL. Scale the research sample size with AGENTIC_REF_RUNS (default 1).
//
// Result JSON carries token usage + app-tests (pre/post) + MCP tool usage in
// `analysis`, composed by agenticRefExperiment's onRunComplete.
import { agenticRefExperiment } from '../lib/agentic-reference/experiment.ts';

export default agenticRefExperiment({
	evals: ['701-agentic-ref-reuse-component-mcp'],
	storybookMcpUrl:
		process.env.AGENTIC_REF_STORYBOOK_MCP_URL ?? 'https://6a4e68f187e29b2ced28b17e-yxetpmuifn.chromatic.com',
});
