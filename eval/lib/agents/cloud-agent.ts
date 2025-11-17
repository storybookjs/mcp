import { query, type SDKMessage, type McpServerConfig as SdkMcpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { styleText } from 'node:util';
import type { Agent, McpServerConfig } from '../../types.ts';
import { spinner, taskLog } from '@clack/prompts';

export const cloudAgent: Agent = {
	async execute(prompt, experimentArgs, mcpServerConfig) {
		const { projectPath, resultsPath, verbose, hooks } = experimentArgs;

		const verboseLog = (verbose &&
			taskLog({
				title: `Executing prompt with Cloud Agent`,
				retainLog: verbose,
			})) as ReturnType<typeof taskLog>;
		const normalLog = (!verbose && spinner()) as ReturnType<typeof spinner>;
		if (!verbose) {
			normalLog.start('Cloud agent is working');
		}

		await hooks.preExecuteAgent?.(experimentArgs, verboseLog ?? normalLog);

		// Convert our McpServerConfig to SDK's expected format
		const sdkMcpServers: Record<string, SdkMcpServerConfig> | undefined =
			mcpServerConfig
				? Object.fromEntries(
						Object.entries(mcpServerConfig).map(([name, config]) => {
							if (config.type === 'stdio') {
								return [
									name,
									{
										type: 'stdio' as const,
										command: config.command,
										args: config.args,
										// SDK expects env as Record<string, string> but our schema has it as string
										// We'll omit it for now if it's present as a string
										env: undefined,
									},
								];
							}
							return [name, config];
						}),
					)
				: undefined;

		// Collect all messages for conversation log
		const messages: SDKMessage[] = [];

		try {
			// Execute the cloud agent query
			const queryResult = query({
				prompt,
				options: {
					cwd: projectPath,
					mcpServers: sdkMcpServers,
					allowDangerouslySkipPermissions: true,
					// Include partial messages to track progress
					includePartialMessages: false,
				},
			});

			let turnCount = 0;

			// Process messages from the agent
			for await (const message of queryResult) {
				messages.push(message);

				if (verbose) {
					verboseLog.message(formatMessageForLog(message, projectPath));
				} else {
					// Update spinner with progress
					if (message.type === 'assistant') {
						turnCount++;
						normalLog.message(`Cloud agent is working, turn ${turnCount}`);
					}
				}
			}

			// Find the result message
			const resultMessage = messages.find(
				(m): m is Extract<SDKMessage, { type: 'result' }> =>
					m.type === 'result',
			);

			if (!resultMessage) {
				const errorMessage = 'No result message received from Cloud Agent';
				if (verbose) {
					verboseLog.error(errorMessage);
				} else {
					normalLog.stop(errorMessage);
				}
				process.exit(1);
			}

			// Save conversation log
			await fs.writeFile(
				path.join(resultsPath, 'conversation.json'),
				JSON.stringify({ prompt, messages }, null, 2),
			);

			const result = {
				cost: Number(resultMessage.total_cost_usd.toFixed(4)),
				duration: Math.round(resultMessage.duration_ms / 1000),
				durationApi: Math.round(resultMessage.duration_api_ms / 1000),
				turns: resultMessage.num_turns,
			};

			const successMessage = `Cloud agent completed in ${result.turns} turns, ${result.duration} seconds, $${result.cost}`;
			await hooks.postExecuteAgent?.(experimentArgs, verboseLog ?? normalLog);

			if (verbose) {
				verboseLog.success(successMessage);
			} else {
				normalLog.stop(successMessage);
			}

			return result;
		} catch (error) {
			const errorMessage = `Cloud agent failed: ${error instanceof Error ? error.message : String(error)}`;
			if (verbose) {
				verboseLog.error(errorMessage);
			} else {
				normalLog.stop(errorMessage);
			}
			throw error;
		}
	},
};

function formatMessageForLog(
	message: SDKMessage,
	projectPath: string,
): string {
	switch (message.type) {
		case 'system': {
			if (message.subtype === 'init') {
				const mcpInfo =
					message.mcp_servers.length > 0
						? styleText(
								['cyan'],
								message.mcp_servers
									.map((s) => `${s.name}:${s.status}`)
									.join(', '),
							)
						: 'None';
				return `[INIT] Model: ${message.model}, Tools: ${message.tools.length}, MCPs: ${mcpInfo}`;
			} else if (message.subtype === 'compact_boundary') {
				return `[COMPACT] Pre-compact tokens: ${message.compact_metadata.pre_tokens}`;
			} else if (message.subtype === 'hook_response') {
				return `[HOOK] ${message.hook_name} (${message.hook_event}): exit ${message.exit_code}`;
			}
			return `[SYSTEM]`;
		}
		case 'assistant': {
			const content = message.message.content;
			const textContent = content.find(
				(c: any): c is Extract<(typeof content)[number], { type: 'text' }> =>
					c.type === 'text',
			);
			const toolUses = content.filter(
				(c: any): c is Extract<(typeof content)[number], { type: 'tool_use' }> =>
					c.type === 'tool_use',
			);

			if (toolUses.length > 0) {
				const toolDescriptions = toolUses.map((t: any) => {
					const isMcpTool = t.name.startsWith('mcp__');
					let toolDesc: string;

					if (
						(t.name === 'Read' || t.name === 'Write' || t.name === 'Edit') &&
						t.input &&
						typeof t.input === 'object' &&
						'file_path' in t.input
					) {
						const relPath = path.relative(
							projectPath,
							String(t.input.file_path),
						);
						toolDesc = `${t.name}(./${relPath})`;
					} else if (
						t.name === 'Bash' &&
						t.input &&
						typeof t.input === 'object' &&
						'command' in t.input
					) {
						const cmd = String(t.input.command);
						const cmdPreview = cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd;
						toolDesc = `Bash(${cmdPreview})`;
					} else {
						toolDesc = t.name;
					}

					return isMcpTool ? styleText('cyan', toolDesc) : toolDesc;
				});
				return `[ASSISTANT] Tools: ${toolDescriptions.join(', ')}`;
			} else if (textContent) {
				const preview = textContent.text.slice(0, 80).replace(/\n/g, ' ');
				return `[ASSISTANT] ${preview}${textContent.text.length > 80 ? '...' : ''}`;
			}
			return `[ASSISTANT] (no content)`;
		}
		case 'user': {
			if ('isSynthetic' in message && message.isSynthetic) {
				return `[USER] Synthetic message`;
			}
			const content = message.message.content;
			return `[USER] Tool results: ${content.length}`;
		}
		case 'result': {
			return `[RESULT] ${message.subtype.toUpperCase()} - ${message.num_turns} turns, ${(message.duration_ms / 1000).toFixed(1)}s, $${message.total_cost_usd.toFixed(4)}`;
		}
		case 'stream_event': {
			return `[STREAM] ${message.event.type}`;
		}
		case 'tool_progress': {
			return `[PROGRESS] ${message.tool_name} (${message.elapsed_time_seconds}s)`;
		}
		case 'auth_status': {
			return `[AUTH] Authenticating: ${message.isAuthenticating}`;
		}
		default:
			return `[UNKNOWN MESSAGE TYPE]`;
	}
}
