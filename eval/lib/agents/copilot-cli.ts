import { x } from 'tinyexec';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spinner, log as clackLog } from '@clack/prompts';
import type { Agent, McpServerConfig, CopilotModel } from '../../types.ts';
import { COPILOT_MODELS } from '../../types.ts';
import { runHook } from '../run-hook.ts';
import type {
	AssistantMessage,
	ConversationMessage,
	ResultMessage,
} from '../../templates/result-docs/conversation.types';

type ToolInteraction = {
	id: string;
	name: string;
	success: boolean;
	rawInput: string;
	output: string;
};

type StreamEvent =
	| { kind: 'block'; text: string; at: number }
	| { kind: 'tool'; interaction: ToolInteraction; at: number };

const BLOCK_GAP_MS = 500;
const USAGE_0 = { input_tokens: 0, output_tokens: 0 } as const;
const TOOL_LINE_REGEX = /^([✓✗])\s+(\S+)\s*(.*)$/;

export const copilotCli: Agent = {
	async execute(prompt, experimentArgs, mcpServerConfig) {
		const { projectPath, resultsPath, model: selectedModel } = experimentArgs;

		// Validate that the model is supported by Copilot CLI
		if (!COPILOT_MODELS.includes(selectedModel as CopilotModel)) {
			throw new Error(
				`Model "${selectedModel}" is not supported by Copilot CLI. Available models: ${COPILOT_MODELS.join(', ')}`,
			);
		}
		const copilotModel = selectedModel as CopilotModel;

		const log = spinner();

		await runHook('pre-execute-agent', experimentArgs);

		log.start(
			`Executing prompt with GitHub Copilot CLI (model: ${copilotModel})`,
		);

		const copilotConfigDir = path.join(projectPath, '.copilot');

		await (mcpServerConfig
			? writeCopilotMcpConfig(copilotConfigDir, mcpServerConfig)
			: fs.mkdir(copilotConfigDir, { recursive: true }));

		const messages: ConversationMessage[] = [
			{
				type: 'system',
				subtype: 'init',
				agent: 'Copilot CLI',
				model: copilotModel,
				tools: [],
				mcp_servers: (mcpServerConfig ? Object.keys(mcpServerConfig) : []).map(
					(name) => ({ name, status: 'unknown' }),
				),
				cwd: projectPath,
				ms: 0,
			},
		];

		const args = ['-p', prompt, '--allow-all-tools', '--model', copilotModel];
		const t0 = Date.now();
		let out = '';
		let err = '';
		const chunks: Array<{ at: number; text: string }> = [];

		try {
			const copilotProcess = x('copilot', args, {
				nodeOptions: {
					cwd: projectPath,
					stdio: ['ignore', 'pipe', 'pipe'],
					// We set the XDG_CONFIG_HOME to the project dir so that copilot CLI can read the MCP config from the project dir
					env: { XDG_CONFIG_HOME: path.dirname(copilotConfigDir) },
				},
			});

			for await (const chunk of copilotProcess) {
				const text = String(chunk);
				if (!text.trim()) continue;
				const at = Date.now();
				chunks.push({ at, text });
				out += text.endsWith('\n') ? text : `${text}\n`;

				const lastLine = text
					.split(/\r?\n/)
					.map((l) => l.trim())
					.filter(Boolean)
					.at(-1);
				if (lastLine) log.message(`Agent is working: ${lastLine}`);
			}

			await copilotProcess;
		} catch (error: any) {
			err = error?.stderr || error?.message || String(error);
			clackLog.error(
				`Copilot CLI failed: ${err.split('\n')[0] || 'unknown error'}`,
			);
		}

		const elapsedMs = Date.now() - t0;
		const apiS = parseDurationSeconds(
			out,
			/Total duration \(API\):\s*([0-9]+)m\s*([0-9.]+)s/i,
		);
		const wallS = parseDurationSeconds(
			out,
			/Total duration \(wall\):\s*([0-9]+)m\s*([0-9.]+)s/i,
		);
		const wallMs = Math.round((wallS ?? elapsedMs / 1000) * 1000);
		const apiMs = Math.round((apiS ?? elapsedMs / 1000) * 1000);

		const events = toEventsFromChunks(chunks, t0);
		if (events.length === 0 && (out || err)) {
			events.push({
				kind: 'block',
				text: (out || err).trim(),
				at: t0,
			});
		}

		let prevAt = t0;
		let toolCount = 0;
		let blockCount = 0;

		for (const e of events) {
			const ms = Math.max(0, e.at - prevAt);
			prevAt = e.at;
			if (e.kind === 'block') {
				blockCount++;
				messages.push({
					type: 'assistant',
					message: {
						content: [{ type: 'text', text: e.text }],
						usage: USAGE_0,
					},
					ms,
				} as AssistantMessage);
			} else {
				toolCount++;
				messages.push({
					type: 'assistant',
					message: {
						usage: USAGE_0,
						content: [
							{
								type: 'tool_use',
								id: e.interaction.id,
								name: `${e.interaction.name} ${e.interaction.rawInput}`,
								input: {},
								isMCP: e.interaction.name.includes('mcp'),
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
								tool_use_id: e.interaction.id,
								content: e.interaction.output,
							},
						],
					},
					ms: 0,
				});
			}
		}

		// Parse token usage from the output
		const tokenUsage = parseTokenUsage(out);
		const totalTokens = tokenUsage
			? tokenUsage.input + tokenUsage.output
			: undefined;

		const isError = err.trim().length > 0;
		const resultMessage: ResultMessage = {
			type: 'result',
			subtype: isError ? 'error' : 'success',
			duration_ms: wallMs,
			duration_api_ms: apiMs,
			num_turns: Math.max(blockCount, 1) + toolCount * 2,
			ms: wallMs,
			total_cost_usd: 0,
			...(totalTokens !== undefined && { tokenCount: totalTokens }),
		};

		messages.push(resultMessage);

		await fs.writeFile(
			path.join(resultsPath, 'conversation.json'),
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

		const successMessage = isError
			? 'Copilot CLI completed with errors'
			: 'Copilot CLI completed';
		await runHook('post-execute-agent', experimentArgs);
		log.stop(successMessage);

		return {
			duration: Math.round(elapsedMs / 1000),
			durationApi: Math.round(apiMs / 1000),
			turns: Math.max(blockCount, 1) + toolCount * 2,
		};
	},
};

function toEventsFromChunks(
	chunks: Array<{ at: number; text: string }>,
	fallbackAt: number,
): StreamEvent[] {
	const lines: Array<{ at: number; text: string }> = [];

	for (const c of chunks) {
		for (const raw of c.text.split(/\r?\n/)) {
			const t = raw.trim();
			if (!t) continue;
			lines.push({ at: c.at, text: t });
		}
	}

	const ev: StreamEvent[] = [];
	/**
	 * Block is a group of lines that are part of the same conversation turn.
	 * Either a block is a tool call or a text message.
	 * If it's a tool call, it will be a group of lines that start with a tool name.
	 * If it's a text message, it will be a group of lines which belongs to the same text message (BLOCK_GAP_MS is used to flush the block).
	 */
	let block: { at: number; lines: string[] } | null = null;
	let lastAt = fallbackAt;
	let toolId = 1;

	const flushBlock = () => {
		if (!block) return;
		const text = block.lines.join('\n').trim();
		if (text) ev.push({ kind: 'block', text, at: block.at });
		block = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const { text, at } = lines[i]!;
		const m = text.match(TOOL_LINE_REGEX);

		if (m) {
			flushBlock();
			const toolName = m[2] ?? 'tool';
			const rawInput = m[3]?.trim() ?? '';

			const next = lines[i + 1];
			let output = '';
			if (next?.text.startsWith('└')) {
				output = next.text;
				i++; // consume output line
			}

			ev.push({
				kind: 'tool',
				interaction: {
					id: `tool-${toolId++}`,
					name: toolName,
					success: m[1] === '✓',
					rawInput,
					output,
				},
				at,
			});
			lastAt = at;
			continue;
		}

		if (!block) {
			block = { at, lines: [text] };
		} else {
			if (at - lastAt > BLOCK_GAP_MS) {
				flushBlock();
				block = { at, lines: [text] };
			} else {
				block.lines.push(text);
			}
		}
		lastAt = at;
	}

	flushBlock();
	return ev;
}

function parseDurationSeconds(text: string, regex: RegExp): number | null {
	const match = text.match(regex);
	if (!match) return null;
	const minutes = Number(match[1] || 0);
	const seconds = Number(match[2] || 0);
	if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
	return minutes * 60 + seconds;
}

/**
 * Parses token counts from Copilot CLI output.
 * Example format:
 * Usage by model:
 * claude-sonnet-4.5    163.2k input, 6.0k output, 100.6k cache read (Est. 1 Premium request)
 *
 * Returns { input, output } token counts, or null if not found.
 */
function parseTokenUsage(
	text: string,
): { input: number; output: number } | null {
	// Match patterns like "163.2k input" or "6.0k output" or "1234 input"
	const inputMatch = text.match(/([0-9.]+)k?\s+input/i);
	const outputMatch = text.match(/([0-9.]+)k?\s+output/i);

	if (!inputMatch && !outputMatch) return null;

	const parseTokenValue = (match: RegExpMatchArray | null): number => {
		if (!match || !match[1]) return 0;
		const value = Number.parseFloat(match[1]);
		if (Number.isNaN(value)) return 0;
		// Check if it's in "k" format (e.g., "163.2k")
		const hasK = match[0].toLowerCase().includes('k');
		return hasK ? Math.round(value * 1000) : Math.round(value);
	};

	return {
		input: parseTokenValue(inputMatch),
		output: parseTokenValue(outputMatch),
	};
}

async function writeCopilotMcpConfig(
	configDir: string,
	mcpServers: McpServerConfig,
): Promise<void> {
	await fs.mkdir(configDir, { recursive: true });
	const configPath = path.join(configDir, 'mcp-config.json');

	const converted: Record<string, any> = {};
	for (const name of Object.keys(mcpServers)) {
		const server = mcpServers[name];
		if (!server) continue;

		switch (server.type) {
			case 'http': {
				converted[name] = {
					type: 'http',
					url: server.url,
					headers: server.headers ?? {},
					tools: (server as any).tools ?? ['*'],
				};
				break;
			}
			case 'stdio': {
				converted[name] = {
					type: 'local',
					command: server.command,
					args: server.args ?? [],
					tools: ['*'],
				};
				break;
			}
			default: {
				const unsupportedServer: never = server;
				throw new Error(
					`Unsupported server type: ${(unsupportedServer as any).type}`,
				);
			}
		}
	}

	await fs.writeFile(
		configPath,
		JSON.stringify({ mcpServers: converted }, null, 2),
	);
}
