// Agentic-reference reuse-component experiment, Codex variant: Codex (gpt-5.5,
// medium effort) runs the 701 reuse-component task with an externally hosted
// design-system Storybook MCP; the eval asserts it consulted the MCP. Direct
// Codex, not gateway-routed (the AI Gateway Codex path mis-handles Codex's
// Responses tool shape). Runs nothing unless EVAL_AGENTIC_REFERENCE=1.
import { agenticRefExperiment } from '../lib/agentic-reference/experiment.ts';

export default agenticRefExperiment({
	agent: 'codex',
	evals: ['701-agentic-ref-reuse-component-mcp'],
	storybookMcpUrl:
		process.env.AGENTIC_REF_STORYBOOK_MCP_URL ?? 'https://6a4e68f187e29b2ced28b17e-yxetpmuifn.chromatic.com',
});
