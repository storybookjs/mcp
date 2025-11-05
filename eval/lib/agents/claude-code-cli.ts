import { x } from 'tinyexec';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExperimentArgs, ExecutionSummary } from '../../types';
import { spinner, taskLog } from '@clack/prompts';

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

function formatMessageForLog(
	message: ClaudeCodeStreamMessage,
	projectPath: string,
): string {
	switch (message.type) {
		case 'system':
			return `[INIT] Model: ${message.model}, Tools: ${message.tools.length}, MCPs: ${message.mcp_servers.length}`;
		case 'assistant': {
			const content = message.message.content;
			const textContent = content.find(
				(c): c is TextContent => c.type === 'text',
			);
			const toolUses = content.filter(
				(c): c is ToolUseContent => c.type === 'tool_use',
			);

			if (toolUses.length > 0) {
				const todoWrite = toolUses.find((t) => t.name === 'TodoWrite');
				if (todoWrite && todoWrite.input.todos) {
					const lines = [];
					lines.push('[ASSISTANT] Todo List:');
					for (const todo of todoWrite.input.todos) {
						let checkbox: string;
						switch (todo.status) {
							case 'completed':
								checkbox = '[x]';
								break;
							case 'in_progress':
								checkbox = '[~]';
								break;
							default:
								checkbox = '[ ]';
						}
						lines.push(`  ${checkbox} ${todo.content}`);
					}
					return lines.join('\n');
				} else {
					const toolDescriptions = toolUses.map((t) => {
						if (
							(t.name === 'Read' || t.name === 'Write' || t.name === 'Edit') &&
							t.input.file_path
						) {
							const relPath = path.relative(projectPath, t.input.file_path);
							return `${t.name}(./${relPath})`;
						}
						if (t.name === 'Bash' && t.input.command) {
							const cmd =
								t.input.command.length > 50
									? t.input.command.slice(0, 50) + '...'
									: t.input.command;
							return `Bash(${cmd})`;
						}
						return t.name;
					});
					return `[ASSISTANT] Tools: ${toolDescriptions.join(', ')}`;
				}
			} else if (textContent) {
				const preview = textContent.text.slice(0, 80).replace(/\n/g, ' ');
				return `[ASSISTANT] ${preview}${textContent.text.length > 80 ? '...' : ''}`;
			}
			return '[ASSISTANT] (no content)';
		}
		case 'user': {
			return `[USER] Tool results: ${message.message.content.length}`;
		}
		case 'result':
			return `[RESULT] ${message.subtype.toUpperCase()} - ${message.num_turns} turns, ${(message.duration_ms / 1000).toFixed(1)}s, $${message.total_cost_usd.toFixed(4)}`;
		default:
			return '[UNKNOWN MESSAGE TYPE]';
	}
}

interface TodoProgress {
	current: number;
	total: number;
	currentTitle: string;
}

function getTodoProgress(
	messages: ClaudeCodeStreamMessage[],
): TodoProgress | null {
	// Find the most recent TodoWrite message
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
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

function formatConversationAsMarkdown(
	messages: ClaudeCodeStreamMessage[],
	projectPath: string,
): string {
	const lines: string[] = ['# Conversation Log\n'];

	for (const message of messages) {
		switch (message.type) {
			case 'system':
				lines.push('## Session Initialized\n');
				lines.push(`- **Model**: ${message.model}`);
				lines.push(`- **Tools**: ${message.tools.join(', ')}`);
				lines.push(
					`- **MCP Servers**: ${message.mcp_servers.join(', ') || 'None'}`,
				);
				lines.push(`- **Working Directory**: ${message.cwd}\n`);
				break;

			case 'assistant': {
				const content = message.message.content;
				const textContent = content.find(
					(c): c is TextContent => c.type === 'text',
				);
				const toolUses = content.filter(
					(c): c is ToolUseContent => c.type === 'tool_use',
				);

				if (toolUses.length > 0) {
					const todoWrite = toolUses.find((t) => t.name === 'TodoWrite');
					if (todoWrite && todoWrite.input.todos) {
						lines.push('## Assistant: Todo List Updated\n');
						for (const todo of todoWrite.input.todos) {
							let checkbox: string;
							switch (todo.status) {
								case 'completed':
									checkbox = '[x]';
									break;
								case 'in_progress':
									checkbox = '[~]';
									break;
								default:
									checkbox = '[ ]';
							}
							lines.push(`- ${checkbox} ${todo.content}`);
						}
						lines.push('');
					} else {
						lines.push('## Assistant: Tool Usage\n');
						for (const tool of toolUses) {
							if (
								(tool.name === 'Read' ||
									tool.name === 'Write' ||
									tool.name === 'Edit') &&
								tool.input.file_path
							) {
								const relPath = path.relative(
									projectPath,
									tool.input.file_path,
								);
								lines.push(`- **${tool.name}**: \`./${relPath}\``);
							} else if (tool.name === 'Bash' && tool.input.command) {
								lines.push(`- **Bash**: \`${tool.input.command}\``);
							} else {
								lines.push(`- **${tool.name}**`);
							}
						}
						lines.push('');
					}
				}
				if (textContent && textContent.text.trim()) {
					lines.push('## Assistant\n');
					lines.push(textContent.text.trim());
					lines.push('');
				}
				break;
			}

			case 'user': {
				const toolResults = message.message.content;
				if (toolResults.length > 0) {
					lines.push(`## User: Tool Results (${toolResults.length})\n`);
				}
				break;
			}

			case 'result':
				lines.push('---\n');
				lines.push('## Final Result\n');
				lines.push(
					`- **Status**: ${message.subtype === 'success' ? '✅ Success' : '❌ Error'}`,
				);
				lines.push(`- **Turns**: ${message.num_turns}`);
				lines.push(
					`- **Duration**: ${(message.duration_ms / 1000).toFixed(1)}s`,
				);
				lines.push(
					`- **API Time**: ${(message.duration_api_ms / 1000).toFixed(1)}s`,
				);
				lines.push(`- **Cost**: $${message.total_cost_usd.toFixed(4)}`);
				lines.push(
					`- **Tokens**: ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`,
				);
				lines.push(
					`- **Cache**: ${message.usage.cache_read_input_tokens} read / ${message.usage.cache_creation_input_tokens} created\n`,
				);

				if (message.result) {
					lines.push('### Summary\n');
					lines.push(message.result);
					lines.push('');
				}
				break;
		}
	}

	return lines.join('\n');
}

export const claudeCodeCli = {
	async execute({
		prompt,
		resultsPath,
		projectPath,
		verbose,
		env,
	}: { prompt: string; env: NodeJS.ProcessEnv } & ExperimentArgs): Promise<ExecutionSummary> {
		const verboseLog = (verbose &&
			taskLog({
				title: `Executing prompt with Claude Code CLI`,
			})) as ReturnType<typeof taskLog>;
		const normalLog = (!verbose && spinner()) as ReturnType<typeof spinner>;
		if (!verbose) {
			normalLog.start('Agent is working');
		}

		const args = [
			'--print',
			'--dangerously-skip-permissions',
			'--output-format=stream-json',
			'--verbose',
			prompt,
		];

		const claudeProcess = x('claude', args, {
			nodeOptions: {
				cwd: projectPath,
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
			messages.push(parsed);
			if (verbose) {
				verboseLog.message(formatMessageForLog(parsed, projectPath));
			} else {
				const todoProgress = getTodoProgress(messages);
				let progressMessage = `Agent is working, turn ${messages.filter(m => m.type === 'assistant').length}`;
				if (todoProgress) {
					progressMessage += `, todo ${todoProgress.current} / ${todoProgress.total}: ${todoProgress.currentTitle}`;
				}
				normalLog.message(progressMessage);
			}
		}
		const resultMessage = messages.find(
			(m): m is ResultMessage => m.type === 'result',
		);
		if (!resultMessage) {
			const errorMessage = 'No result message received from Claude Code CLI';
			if(verbose){
				verboseLog.error(errorMessage);
			} else {
				normalLog.stop(errorMessage);
			}
			process.exit(1);
		}
		await claudeProcess;

		await Promise.all([
			fs.writeFile(
				path.join(resultsPath, 'full-conversation.json'),
				JSON.stringify(messages, null, 2),
			),
			fs.writeFile(
				path.join(resultsPath, 'full-conversation.md'),
				formatConversationAsMarkdown(messages, projectPath),
			),
		]);


		const result = {
			cost: Number(resultMessage.total_cost_usd.toFixed(4)),
			duration: Math.round(resultMessage.duration_ms / 1000),
			durationApi: Math.round(resultMessage.duration_api_ms / 1000),
			turns: resultMessage.num_turns,
		};
		const successMessage = `Agent completed in ${result.turns} turns, ${result.duration} seconds, $${result.cost}`;
		if(verbose){
			verboseLog.success(successMessage);
		} else {
			normalLog.stop(successMessage);
		}

		return result;
	},
};
