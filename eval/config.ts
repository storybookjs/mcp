import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import { copilotCli } from './lib/agents/copilot-cli.ts';
import { codexCli } from './lib/agents/codex-cli.ts';

export const agents = {
	'claude-code': claudeCodeCli,
	'copilot-cli': copilotCli,
	'codex-cli': codexCli,
};
