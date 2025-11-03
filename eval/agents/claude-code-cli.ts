import { x } from 'tinyexec';
import * as path from 'node:path';

// Claude Code CLI Stream JSON Output Types

interface BaseMessage {
	session_id: string;
	uuid: string;
}

interface SystemInitMessage extends BaseMessage {
	type: 'system';
	subtype: 'init';
	cwd: string;
	tools: string[];
	mcp_servers: string[];
	model: string;
	permissionMode: string;
	slash_commands: string[];
	apiKeySource: string;
	claude_code_version: string;
	output_style: string;
	agents: string[];
	skills: string[];
	plugins: string[];
}

interface MessageUsage {
	input_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	cache_creation: {
		ephemeral_5m_input_tokens: number;
		ephemeral_1h_input_tokens: number;
	};
	output_tokens: number;
	service_tier: string;
}

interface TextContent {
	type: 'text';
	text: string;
}

interface ToolUseContent {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, any>;
}

interface ToolResultContent {
	tool_use_id: string;
	type: 'tool_result';
	content: string;
}

interface AssistantMessage extends BaseMessage {
	type: 'assistant';
	message: {
		model: string;
		id: string;
		type: 'message';
		role: 'assistant';
		content: (TextContent | ToolUseContent)[];
		stop_reason: string | null;
		stop_sequence: string | null;
		usage: MessageUsage;
	};
	parent_tool_use_id: string | null;
}

interface UserMessage extends BaseMessage {
	type: 'user';
	message: {
		role: 'user';
		content: ToolResultContent[];
	};
	parent_tool_use_id: string | null;
}

interface ModelUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	webSearchRequests: number;
	costUSD: number;
	contextWindow: number;
}

interface ResultUsage {
	input_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	output_tokens: number;
	server_tool_use: {
		web_search_requests: number;
	};
	service_tier: string;
	cache_creation: {
		ephemeral_1h_input_tokens: number;
		ephemeral_5m_input_tokens: number;
	};
}

interface ResultMessage extends BaseMessage {
	type: 'result';
	subtype: 'success' | 'error';
	is_error: boolean;
	duration_ms: number;
	duration_api_ms: number;
	num_turns: number;
	result: string;
	total_cost_usd: number;
	usage: ResultUsage;
	modelUsage: Record<string, ModelUsage>;
	permission_denials: any[];
}

type ClaudeCodeStreamMessage =
	| SystemInitMessage
	| AssistantMessage
	| UserMessage
	| ResultMessage;

export const claudeCodeCli = {
	async execute({
		prompt,
		projectDir,
		env,
	}: {
		prompt: string;
		projectDir: string;
		env: Record<string, string>;
	}) {
		const args = [
			'--print',
			'--dangerously-skip-permissions',
			'--output-format=stream-json',
			'--verbose',
			prompt,
		];

		const startTime = Date.now();

		const claudeProcess = x('claude', args, {
			nodeOptions: {
				cwd: projectDir,
				env,
				stdio: ['pipe', 'pipe', 'pipe'], // pipe stdin to send "yes" for MCP prompts
			},
		});
		// Auto-approve MCP server trust prompt by sending "1" (Yes, proceed)
		if (claudeProcess.process?.stdin) {
			claudeProcess.process?.stdin.write('1\n');
			claudeProcess.process?.stdin.end();
		}
		const messages: ClaudeCodeStreamMessage[] = [];
		for await (const message of claudeProcess) {
			const parsed = JSON.parse(message) as ClaudeCodeStreamMessage;
			console.log(JSON.stringify(parsed, null, 2));
			messages.push(parsed);
		}
		const resultMessage = messages.find(
			(m): m is ResultMessage => m.type === 'result',
		);
		if(!resultMessage) {
			throw new Error('No result message received from Claude Code CLI');
		}
		await claudeProcess;
		console.timeEnd('claude-code-cli-execute');

		return {
			cost: resultMessage.total_cost_usd,
			duration: resultMessage.duration_ms / 1000,
			durationApi: resultMessage.duration_api_ms / 1000,
			durationWall: (Date.now() - startTime) / 1000,
			turns: resultMessage.num_turns,
		};
	},
};
