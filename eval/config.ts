import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import { copilotCli } from './lib/agents/copilot-cli.ts';

export const agents = {
	'claude-code': claudeCodeCli,
	'copilot-cli': copilotCli,
};
