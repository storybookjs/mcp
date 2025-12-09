import { x } from 'tinyexec';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Agent } from '../../types.ts';
import { spinner, log as clackLog } from '@clack/prompts';
import Tokenizer, { models, type Model } from 'ai-tokenizer';
import { runHook } from '../run-hook.ts';

interface BaseMessage {
	session_id: string;
	uuid: string;
	ms: number;
	tokenCount?: number;
	costUSD?: number;
}

interface McpServer {
	name: string;
	status: string;
}

interface SystemInitMessage extends BaseMessage {
	type: 'system';
	subtype: 'init';
	cwd: string;
	tools: string[];
	mcp_servers: McpServer[];
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

interface TodoProgress {
	current: number;
	total: number;
	currentTitle: string;
}

function calculateMessageTokenCount(
	message: ClaudeCodeStreamMessage,
	tokenizer: Tokenizer,
	model: Model,
): {
	tokens: number;
	cost: number;
} {
	if (message.type === 'assistant') {
		const content = message.message.content.map((c) => {
			if (c.type === 'text') {
				return { type: c.type, text: c.text };
			} else if (c.type === 'tool_use') {
				return { type: c.type, id: c.id, name: c.name, input: c.input };
			}
			return c;
		});

		try {
			const tokens = tokenizer.count(
				JSON.stringify({ role: 'assistant', content }),
			);
			const cost = tokens * model.pricing.input;
			return { tokens, cost };
		} catch (error) {
			console.warn('Failed to count tokens:', error);
			return { tokens: 0, cost: 0 };
		}
	} else if (message.type === 'user') {
		const content = message.message.content.map((c) => ({
			type: c.type,
			tool_use_id: c.tool_use_id,
			content: c.content,
		}));

		try {
			const tokens = tokenizer.count(JSON.stringify({ role: 'user', content }));
			const cost = tokens * model.pricing.input;
			return { tokens, cost };
		} catch (error) {
			console.warn('Failed to count tokens:', error);
			return { tokens: 0, cost: 0 };
		}
	}

	return { tokens: 0, cost: 0 };
}

function getTodoProgress(
	messages: ClaudeCodeStreamMessage[],
): TodoProgress | null {
	// Find the most recent TodoWrite message
	for (const message of messages.toReversed()) {
		if (message.type === 'assistant') {
			const todoWrite = message.message.content.find(
				(c): c is ToolUseContent =>
					c.type === 'tool_use' && c.name === 'TodoWrite',
			);
			if (todoWrite?.input.todos) {
				const todos = todoWrite.input.todos;
				const total = todos.length;
				const completed = todos.filter(
					(t: any) => t.status === 'completed',
				).length;
				const inProgress = todos.find((t: any) => t.status === 'in_progress');

				if (inProgress) {
					return {
						current: completed + 1,
						total,
						currentTitle: inProgress.content || 'Working',
					};
				} else if (completed === total && total > 0) {
					return {
						current: total,
						total,
						currentTitle: 'Finalizing',
					};
				} else if (total > 0) {
					return {
						current: completed,
						total,
						currentTitle: todos[completed]?.content || 'Working',
					};
				}
			}
		}
	}
	return null;
}

export const claudeCodeCli: Agent = {
	async execute(prompt, experimentArgs, mcpServerConfig) {
		const { projectPath, resultsPath } = experimentArgs;
		if (mcpServerConfig) {
			await fs.writeFile(
				path.join(projectPath, '.mcp.json'),
				JSON.stringify({ mcpServers: mcpServerConfig }, null, 2),
			);
		}
		const log = spinner();
		await runHook('pre-execute-agent', experimentArgs);

		log.start('Executing prompt with Claude Code CLI');
		const claudeEncoding = await import('ai-tokenizer/encoding/claude');
		const model = models['anthropic/claude-sonnet-4.5'];
		const tokenizer = new Tokenizer(claudeEncoding);

		const args = [
			'--print',
			'--dangerously-skip-permissions',
			'--output-format=stream-json',
			'--verbose',
			prompt,
		];

		if (mcpServerConfig) {
			args.unshift('--mcp-config=.mcp.json');
		}

		const claudeProcess = x('claude', args, {
			nodeOptions: {
				cwd: projectPath,
				stdio: ['pipe', 'pipe', 'pipe'], // pipe stdin to send "yes" for MCP prompts
			},
		});
		// Auto-approve MCP server trust prompt by sending "1" (Yes, proceed)
		if (claudeProcess.process?.stdin) {
			claudeProcess.process?.stdin.write('1\n');
			claudeProcess.process?.stdin.end();
		}
		const messages: ClaudeCodeStreamMessage[] = [];
		let previousMs = Date.now();
		for await (const message of claudeProcess) {
			const parsed = JSON.parse(message) as ClaudeCodeStreamMessage;
			// Set startTime on first message and calculate elapsed time

			const deltaMs = Date.now() - previousMs;
			previousMs = Date.now();

			parsed.ms = deltaMs;
			const tokenData = calculateMessageTokenCount(parsed, tokenizer, model);
			parsed.tokenCount = tokenData.tokens;
			parsed.costUSD = tokenData.cost;
			messages.push(parsed);

			// Check for MCP server status in init message
			if (
				parsed.type === 'system' &&
				parsed.subtype === 'init' &&
				parsed.mcp_servers &&
				parsed.mcp_servers.length > 0
			) {
				for (const server of parsed.mcp_servers) {
					if (server.status === 'connected') {
						clackLog.success(`MCP server "${server.name}" connected`);
					} else {
						clackLog.error(
							`MCP server "${server.name}" failed to connect (status: ${server.status})`,
						);
						process.exit(1);
					}
				}
			}

			const todoProgress = getTodoProgress(messages);
			let progressMessage = `Agent is working, turn ${messages.filter((m) => m.type === 'assistant').length}`;
			if (todoProgress) {
				progressMessage += `, todo ${todoProgress.current} / ${todoProgress.total}: ${todoProgress.currentTitle}`;
			}
			log.message(progressMessage);
		}
		const resultMessage = messages.find(
			(m): m is ResultMessage => m.type === 'result',
		);
		if (!resultMessage) {
			log.error('No result message received from Claude Code CLI');
			process.exit(1);
		}
		await claudeProcess;

		const promptTokenCount = tokenizer.count(
			JSON.stringify({
				role: 'user',
				content: [{ type: 'text', text: prompt }],
			}),
		);

		await fs.writeFile(
			path.join(resultsPath, 'conversation.json'),
			JSON.stringify({ prompt, promptTokenCount, messages }, null, 2),
		);
		const result = {
			cost: Number(resultMessage.total_cost_usd.toFixed(4)),
			duration: Math.round(resultMessage.duration_ms / 1000),
			durationApi: Math.round(resultMessage.duration_api_ms / 1000),
			turns: resultMessage.num_turns,
		};
		const successMessage = `Agent completed in ${result.turns} turns, ${result.duration} seconds, $${result.cost}`;
		await runHook('post-execute-agent', experimentArgs);
		log.stop(successMessage);

		return result;
	},
};
