import { x } from 'tinyexec';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spinner, log as clackLog } from '@clack/prompts';
import type { Agent, McpServerConfig, CodexModel } from '../../types.ts';
import { CODEX_MODELS, CODEX_MODEL_MAP } from '../../types.ts';
import { runHook } from '../run-hook.ts';
import type {
	AssistantMessage,
	TranscriptMessage,
	ResultMessage,
} from '../../templates/result-docs/transcript.types.ts';

const USAGE_0 = { input_tokens: 0, output_tokens: 0 } as const;

/**
 * JSONL event shapes emitted by `codex exec --json`.
 * @see https://developers.openai.com/codex/noninteractive
 */
interface ThreadStartedEvent {
	type: 'thread.started';
	thread_id: string;
}

interface TurnCompletedEvent {
	type: 'turn.completed';
	usage?: {
		input_tokens?: number;
		cached_input_tokens?: number;
		output_tokens?: number;
	};
}

interface AgentMessageItem {
	id: string;
	type: 'agent_message';
	text: string;
}

interface ReasoningItem {
	id: string;
	type: 'reasoning';
	text: string;
}

interface CommandExecutionItem {
	id: string;
	type: 'command_execution';
	command: string;
	aggregated_output?: string;
	exit_code?: number;
	status?: string;
}

interface McpToolCallItem {
	id: string;
	type: 'mcp_tool_call';
	server: string;
	tool: string;
	arguments?: Record<string, unknown>;
	result?: unknown;
	error?: unknown;
	status?: string;
}

type CodexItem =
	| AgentMessageItem
	| ReasoningItem
	| CommandExecutionItem
	| McpToolCallItem
	| { id: string; type: string; [key: string]: unknown };

interface ItemCompletedEvent {
	type: 'item.completed';
	item: CodexItem;
}

type CodexEvent =
	| ThreadStartedEvent
	| TurnCompletedEvent
	| ItemCompletedEvent
	| { type: string; [key: string]: unknown };

export const codexCli: Agent = {
	async execute(prompt, trialArgs, mcpServerConfig) {
		const { projectPath, resultsPath, model: selectedModel } = trialArgs;

		// Validate that the model is supported by Codex CLI
		if (!CODEX_MODELS.includes(selectedModel as CodexModel)) {
			throw new Error(
				`Model "${selectedModel}" is not supported by Codex CLI. Available models: ${CODEX_MODELS.join(', ')}`,
			);
		}
		const codexModel = selectedModel as CodexModel;

		// Map our model name to the Codex CLI --model flag value
		const codexCliModelFlag = CODEX_MODEL_MAP[codexModel];

		const log = spinner();

		await runHook('pre-execute-agent', trialArgs);

		log.start(`Executing prompt with Codex CLI (model: ${codexModel})`);

		// Codex reads config.toml, skills/, and auth from $CODEX_HOME (default ~/.codex).
		// The `plugin-skills:codex` mechanism installs skills into `<project>/.codex/skills`,
		// so we point CODEX_HOME at the project's `.codex` dir to discover those skills and
		// any project-scoped MCP config — mirroring how copilot-cli sets XDG_CONFIG_HOME.
		const codexConfigDir = path.join(projectPath, '.codex');
		await fs.mkdir(codexConfigDir, { recursive: true });

		if (mcpServerConfig) {
			await writeCodexMcpConfig(codexConfigDir, mcpServerConfig);
		}

		const messages: TranscriptMessage[] = [
			{
				type: 'system',
				subtype: 'init',
				agent: 'Codex CLI',
				model: codexModel,
				tools: [],
				mcp_servers: (mcpServerConfig ? Object.keys(mcpServerConfig) : []).map((name) => ({
					name,
					status: 'unknown',
				})),
				cwd: projectPath,
				ms: 0,
			},
		];

		// `codex exec` runs non-interactively. `--json` emits JSONL events on stdout.
		// `-C` sets the working root, `--skip-git-repo-check` allows non-git projects,
		// and `--dangerously-bypass-approvals-and-sandbox` runs fully autonomously without
		// approval prompts or codex's own sandbox (the harness already isolates each trial).
		const args = [
			'exec',
			'--json',
			'--skip-git-repo-check',
			'--dangerously-bypass-approvals-and-sandbox',
			'-C',
			projectPath,
			'--model',
			codexCliModelFlag,
			prompt,
		];

		const t0 = Date.now();
		let out = '';
		let err = '';
		let buffer = '';
		let prevAt = t0;
		let blockCount = 0;
		let toolCount = 0;
		let toolId = 1;
		let totalTokens: number | undefined;

		const handleEvent = (event: CodexEvent) => {
			const at = Date.now();
			const ms = Math.max(0, at - prevAt);
			prevAt = at;

			if (event.type === 'turn.completed') {
				const usage = (event as TurnCompletedEvent).usage;
				if (usage) {
					totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
				}
				return;
			}

			if (event.type !== 'item.completed') return;
			const item = (event as ItemCompletedEvent).item;

			if (item.type === 'agent_message') {
				const text = (item as AgentMessageItem).text ?? '';
				if (!text.trim()) return;
				blockCount++;
				messages.push({
					type: 'assistant',
					message: {
						content: [{ type: 'text', text }],
						usage: USAGE_0,
					},
					ms,
				} as AssistantMessage);
				const firstLine = text.split(/\r?\n/).find((l) => l.trim());
				if (firstLine) log.message(`Agent is working: ${firstLine.trim()}`);
				return;
			}

			if (item.type === 'command_execution') {
				const cmd = item as CommandExecutionItem;
				toolCount++;
				messages.push({
					type: 'assistant',
					message: {
						usage: USAGE_0,
						content: [
							{
								type: 'tool_use',
								id: `tool-${toolId}`,
								name: `shell ${cmd.command ?? ''}`.trim(),
								input: { command: cmd.command ?? '' },
								isMCP: false,
							},
						],
					},
					ms,
				});
				messages.push({
					type: 'user',
					message: {
						content: [
							{
								type: 'tool_result',
								tool_use_id: `tool-${toolId}`,
								content: cmd.aggregated_output ?? '',
							},
						],
					},
					ms: 0,
				});
				toolId++;
				log.message(`Agent ran: ${cmd.command ?? 'command'}`);
				return;
			}

			if (item.type === 'mcp_tool_call') {
				const call = item as McpToolCallItem;
				toolCount++;
				messages.push({
					type: 'assistant',
					message: {
						usage: USAGE_0,
						content: [
							{
								type: 'tool_use',
								id: `tool-${toolId}`,
								name: `${call.server}__${call.tool}`,
								input: (call.arguments as Record<string, unknown>) ?? {},
								isMCP: true,
							},
						],
					},
					ms,
				});
				messages.push({
					type: 'user',
					message: {
						content: [
							{
								type: 'tool_result',
								tool_use_id: `tool-${toolId}`,
								content: serializeResult(call.result ?? call.error),
							},
						],
					},
					ms: 0,
				});
				toolId++;
				log.message(`Agent called MCP tool: ${call.server}__${call.tool}`);
				return;
			}

			// reasoning and any other item types are ignored for the transcript.
		};

		const flushBuffer = (final: boolean) => {
			const segments = buffer.split('\n');
			// Keep the trailing partial line in the buffer unless this is the final flush.
			buffer = final ? '' : (segments.pop() ?? '');
			for (const line of segments) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					handleEvent(JSON.parse(trimmed) as CodexEvent);
				} catch {
					// Non-JSON lines (e.g. human-readable banners) are ignored.
				}
			}
		};

		try {
			const codexProcess = x('codex', args, {
				nodeOptions: {
					cwd: projectPath,
					stdio: ['ignore', 'pipe', 'pipe'],
					// Point CODEX_HOME at the project's `.codex` so codex discovers
					// project-scoped skills and MCP config written above.
					env: { CODEX_HOME: codexConfigDir },
				},
			});

			for await (const chunk of codexProcess) {
				const text = String(chunk);
				out += text;
				buffer += text;
				flushBuffer(false);
			}
			flushBuffer(true);

			await codexProcess;
		} catch (error: any) {
			err = error?.stderr || error?.message || String(error);
			clackLog.error(`Codex CLI failed: ${err.split('\n')[0] || 'unknown error'}`);
		}

		const elapsedMs = Date.now() - t0;

		// Codex does not report a separate API duration, so wall and API durations match.
		const wallMs = elapsedMs;
		const apiMs = elapsedMs;

		// If nothing parsed but we captured output, surface it as a single block.
		if (blockCount === 0 && toolCount === 0 && (out.trim() || err.trim())) {
			messages.push({
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: (out || err).trim() }],
					usage: USAGE_0,
				},
				ms: 0,
			} as AssistantMessage);
			blockCount++;
		}

		const isError = err.trim().length > 0;
		const numTurns = Math.max(blockCount, 1) + toolCount * 2;
		const resultMessage: ResultMessage = {
			type: 'result',
			subtype: isError ? 'error' : 'success',
			duration_ms: wallMs,
			duration_api_ms: apiMs,
			num_turns: numTurns,
			ms: wallMs,
			total_cost_usd: 0,
			...(totalTokens !== undefined && { tokenCount: totalTokens }),
		};

		messages.push(resultMessage);

		await fs.writeFile(
			path.join(resultsPath, 'transcript.json'),
			JSON.stringify(
				{
					prompt,
					promptTokenCount: 0,
					promptCost: 0,
					messages,
				},
				null,
				2,
			),
		);

		const successMessage = isError ? 'Codex CLI completed with errors' : 'Codex CLI completed';
		await runHook('post-execute-agent', trialArgs);
		log.stop(successMessage);

		return {
			agent: 'Codex CLI',
			model: codexModel,
			duration: Math.round(elapsedMs / 1000),
			durationApi: Math.round(apiMs / 1000),
			turns: numTurns,
		};
	},
};

/**
 * Serializes an MCP tool result (or error) into a string for the transcript.
 */
function serializeResult(result: unknown): string {
	if (result === undefined || result === null) return '';
	if (typeof result === 'string') return result;
	try {
		return JSON.stringify(result);
	} catch {
		return String(result);
	}
}

/**
 * Writes MCP server config into `<codexConfigDir>/config.toml` under `[mcp_servers.<name>]`.
 * Codex supports stdio servers (command/args/env) and streamable HTTP servers (url/headers).
 * See https://github.com/openai/codex/blob/main/docs/config.md.
 */
async function writeCodexMcpConfig(
	configDir: string,
	mcpServers: McpServerConfig,
): Promise<void> {
	await fs.mkdir(configDir, { recursive: true });
	const configPath = path.join(configDir, 'config.toml');

	const sections: string[] = [];
	for (const name of Object.keys(mcpServers)) {
		const server = mcpServers[name];
		if (!server) continue;

		switch (server.type) {
			case 'http': {
				sections.push(`[mcp_servers.${tomlKey(name)}]`);
				sections.push(`url = ${tomlString(server.url)}`);
				if (server.headers) {
					const entries = Object.entries(server.headers).map(
						([k, val]) => `${tomlKey(k)} = ${tomlString(val)}`,
					);
					if (entries.length > 0) {
						sections.push(`http_headers = { ${entries.join(', ')} }`);
					}
				}
				break;
			}
			case 'stdio': {
				sections.push(`[mcp_servers.${tomlKey(name)}]`);
				sections.push(`command = ${tomlString(server.command)}`);
				const serverArgs = server.args ?? [];
				sections.push(`args = [${serverArgs.map((a) => tomlString(a)).join(', ')}]`);
				break;
			}
			default: {
				const unsupportedServer: never = server;
				throw new Error(`Unsupported server type: ${(unsupportedServer as any).type}`);
			}
		}
		sections.push('');
	}

	await fs.writeFile(configPath, `${sections.join('\n').trimEnd()}\n`);
}

/**
 * Quotes a TOML bare key only when needed (keys with non-identifier characters).
 */
function tomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/**
 * Serializes a string as a TOML basic string with the necessary escapes.
 */
function tomlString(value: string): string {
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
	return `"${escaped}"`;
}
