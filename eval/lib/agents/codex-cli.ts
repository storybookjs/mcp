import { x } from 'tinyexec';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spinner, log as clackLog } from '@clack/prompts';
import type { Agent, McpServerConfig, CodexModel } from '../../types.ts';
import { CODEX_MODELS, CODEX_MODEL_MAP } from '../../types.ts';
import { runHook } from '../run-hook.ts';
import type {
	AssistantMessage,
	ResultMessage,
	ToolResultContent,
	ToolUseContent,
	TranscriptMessage,
	UserMessage,
} from '../../templates/result-docs/transcript.types.ts';

const USAGE_0 = { input_tokens: 0, output_tokens: 0 } as const;

/**
 * Per-token USD pricing for Codex models. The Codex CLI does not report a USD cost
 * (its `--json` stream only includes token counts), so we estimate it from the reported
 * usage. All current GPT-5 codex tiers share the same public pricing
 * (input $1.25/1M, cached input $0.125/1M, output $10/1M); the estimate is approximate
 * and N/A for ChatGPT-subscription billing.
 *
 * @see https://platform.openai.com/docs/pricing
 */
const CODEX_PRICING = {
	input: 1.25e-6,
	cachedInput: 1.25e-7,
	output: 1e-5,
} as const;

/**
 * Estimates USD cost from Codex token usage. `input_tokens` is inclusive of
 * `cached_input_tokens`, which are billed at the cheaper cache-read rate.
 */
function estimateCodexCost(usage: { input: number; cached: number; output: number }): number {
	const uncachedInput = Math.max(0, usage.input - usage.cached);
	return (
		uncachedInput * CODEX_PRICING.input +
		usage.cached * CODEX_PRICING.cachedInput +
		usage.output * CODEX_PRICING.output
	);
}

/**
 * Shapes of the `codex exec --json` (experimental) event stream.
 * Each stdout line is one JSON object. We only model the fields we consume.
 */
type CodexItem =
	| { id: string; type: 'agent_message'; text: string }
	| { id: string; type: 'reasoning'; text?: string }
	| {
			id: string;
			type: 'command_execution';
			command: string;
			aggregated_output?: string;
			exit_code?: number | null;
			status?: string;
	  }
	| {
			id: string;
			type: 'mcp_tool_call';
			server: string;
			tool: string;
			arguments?: Record<string, unknown>;
			result?: {
				content?: Array<{ type: string; text?: string }>;
				structured_content?: unknown;
			} | null;
			error?: string | null;
			status?: string;
	  }
	| { id: string; type: string; [key: string]: unknown };

type CodexEvent = {
	type: string;
	item?: CodexItem;
	usage?: {
		input_tokens?: number;
		cached_input_tokens?: number;
		output_tokens?: number;
		reasoning_output_tokens?: number;
	};
	error?: { message?: string };
};

/** Stringifies an MCP tool result's content for the transcript tool_result. */
function stringifyMcpResult(item: Extract<CodexItem, { type: 'mcp_tool_call' }>): string {
	if (item.error) {
		return `Error: ${item.error}`;
	}
	const content = item.result?.content;
	if (Array.isArray(content)) {
		return content
			.filter((c) => c.type === 'text' && typeof c.text === 'string')
			.map((c) => c.text ?? '')
			.join('');
	}
	return item.result ? JSON.stringify(item.result) : '';
}

/**
 * Converts our normalized MCP server config into `codex exec -c` config overrides.
 * Returns the flat list of CLI args (pairs of `-c key=value`).
 *
 * The value portion is parsed by Codex as TOML; JSON encoding of strings/arrays is
 * valid TOML, so we encode with JSON.stringify.
 */
function buildMcpConfigArgs(mcpServers: McpServerConfig): string[] {
	const args: string[] = [];
	const add = (key: string, tomlValue: string) => {
		args.push('-c', `${key}=${tomlValue}`);
	};

	for (const name of Object.keys(mcpServers)) {
		const server = mcpServers[name];
		if (!server) continue;
		const base = `mcp_servers.${JSON.stringify(name)}`;

		switch (server.type) {
			case 'http': {
				add(`${base}.url`, JSON.stringify(server.url));
				if (server.headers && Object.keys(server.headers).length > 0) {
					const headersToml = `{ ${Object.entries(server.headers)
						.map(([k, v]) => `${JSON.stringify(k)} = ${JSON.stringify(v)}`)
						.join(', ')} }`;
					add(`${base}.http_headers`, headersToml);
				}
				break;
			}
			case 'stdio': {
				add(`${base}.command`, JSON.stringify(server.command));
				if (server.args && server.args.length > 0) {
					add(`${base}.args`, JSON.stringify(server.args));
				}
				if (server.env) {
					add(`${base}.env`, JSON.stringify(server.env));
				}
				break;
			}
			default: {
				const unsupported: never = server;
				throw new Error(`Unsupported server type: ${(unsupported as { type: string }).type}`);
			}
		}
	}

	return args;
}

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
		const codexModelFlag = CODEX_MODEL_MAP[codexModel];

		const log = spinner();
		await runHook('pre-execute-agent', trialArgs);
		log.start(`Executing prompt with Codex CLI (model: ${codexModel})`);

		const hasMcp = Boolean(mcpServerConfig && Object.keys(mcpServerConfig).length > 0);

		const args = [
			'exec',
			'--json',
			// Run from the user's auth but ignore their global config.toml so trials are not
			// polluted by the developer's personal Codex settings/MCP servers (auth still
			// resolves from CODEX_HOME).
			'--ignore-user-config',
			'--skip-git-repo-check',
			// Equivalent to Claude's --dangerously-skip-permissions: let the agent write files
			// and run commands without approval prompts (the eval is the sandbox boundary).
			'--dangerously-bypass-approvals-and-sandbox',
			'--color',
			'never',
			'-C',
			projectPath,
			// An empty flag value (e.g. the `codex-default` model) means "let Codex pick the
			// account-default model" — required for ChatGPT-account auth, which rejects
			// explicit codex model names.
			...(codexModelFlag ? ['-m', codexModelFlag] : []),
			...(hasMcp ? buildMcpConfigArgs(mcpServerConfig!) : []),
			// Read the prompt from stdin (robust against prompts containing leading dashes).
			'-',
		];

		const messages: TranscriptMessage[] = [
			{
				type: 'system',
				subtype: 'init',
				agent: 'Codex CLI',
				model: codexModel,
				tools: [],
				mcp_servers: (hasMcp ? Object.keys(mcpServerConfig!) : []).map((name) => ({
					name,
					status: 'unknown',
				})),
				cwd: projectPath,
				ms: 0,
			},
		];

		const t0 = Date.now();
		let stderr = '';
		let turnUsage: { input: number; cached: number; output: number } | undefined;
		let assistantCount = 0;
		let toolCount = 0;
		let turnFailedError: string | undefined;

		const pushAssistantText = (text: string) => {
			if (!text.trim()) return;
			assistantCount++;
			messages.push({
				type: 'assistant',
				message: { content: [{ type: 'text', text }], usage: USAGE_0 },
				ms: 0,
			} satisfies AssistantMessage);
		};

		const pushToolUse = (toolUse: ToolUseContent, result: string) => {
			toolCount++;
			messages.push({
				type: 'assistant',
				message: { content: [toolUse], usage: USAGE_0 },
				ms: 0,
			} satisfies AssistantMessage);
			const toolResult: ToolResultContent = {
				type: 'tool_result',
				tool_use_id: toolUse.id,
				content: result,
			};
			messages.push({
				type: 'user',
				message: { content: [toolResult] },
				ms: 0,
			} satisfies UserMessage);
		};

		const handleItem = (item: CodexItem) => {
			switch (item.type) {
				case 'agent_message': {
					pushAssistantText((item as Extract<CodexItem, { type: 'agent_message' }>).text ?? '');
					break;
				}
				case 'command_execution': {
					const cmd = item as Extract<CodexItem, { type: 'command_execution' }>;
					pushToolUse(
						{
							type: 'tool_use',
							id: cmd.id,
							name: 'Bash',
							input: { command: cmd.command },
							isMCP: false,
						},
						cmd.aggregated_output ?? '',
					);
					break;
				}
				case 'mcp_tool_call': {
					const call = item as Extract<CodexItem, { type: 'mcp_tool_call' }>;
					pushToolUse(
						{
							type: 'tool_use',
							id: call.id,
							// Mirror the canonical Claude MCP tool naming (`mcp__<server>__<tool>`)
							// so the MCP-tools grader matches expectations via includes().
							name: `mcp__${call.server}__${call.tool}`,
							input: call.arguments ?? {},
							isMCP: true,
						},
						stringifyMcpResult(call),
					);
					break;
				}
				default:
					// reasoning, todo_list, file changes, etc. — not needed for grading.
					break;
			}
		};

		try {
			const codexProcess = x('codex', args, {
				nodeOptions: {
					cwd: projectPath,
					stdio: ['pipe', 'pipe', 'pipe'],
				},
			});

			// Feed the prompt via stdin and close it.
			if (codexProcess.process?.stdin) {
				codexProcess.process.stdin.write(prompt);
				codexProcess.process.stdin.end();
			}

			// tinyexec yields stdout line-by-line (newlines stripped); a chunk may still
			// contain multiple lines, so split defensively and parse each JSONL event.
			for await (const chunk of codexProcess) {
				for (const line of String(chunk).split(/\r?\n/)) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					let event: CodexEvent;
					try {
						event = JSON.parse(trimmed) as CodexEvent;
					} catch {
						// Non-JSON line (e.g. a stray log); ignore.
						continue;
					}

					if (event.type === 'item.completed' && event.item) {
						handleItem(event.item);
						log.message(`Agent is working, ${assistantCount} messages, ${toolCount} tool calls`);
					} else if (event.type === 'turn.completed') {
						// codex exec emits a single turn.completed with the session's total usage.
						turnUsage = {
							input: event.usage?.input_tokens ?? 0,
							cached: event.usage?.cached_input_tokens ?? 0,
							output: event.usage?.output_tokens ?? 0,
						};
					} else if (event.type === 'turn.failed') {
						turnFailedError = event.error?.message ?? 'turn failed';
					}
				}
			}

			await codexProcess;
		} catch (error: unknown) {
			const err = error as { stderr?: string; message?: string };
			stderr = err?.stderr || err?.message || String(error);
			clackLog.error(`Codex CLI failed: ${stderr.split('\n')[0] || 'unknown error'}`);
		}

		const elapsedMs = Date.now() - t0;
		const isError = turnFailedError !== undefined || stderr.trim().length > 0;
		const totalTokens = turnUsage ? turnUsage.input + turnUsage.output : undefined;
		// Codex does not report a USD cost; estimate it from the reported token usage.
		const estimatedCost = turnUsage ? Number(estimateCodexCost(turnUsage).toFixed(4)) : undefined;

		const numTurns = Math.max(assistantCount, 1) + toolCount * 2;
		const resultMessage: ResultMessage = {
			type: 'result',
			subtype: isError ? 'error' : 'success',
			duration_ms: elapsedMs,
			duration_api_ms: elapsedMs,
			num_turns: numTurns,
			total_cost_usd: estimatedCost ?? 0,
			ms: elapsedMs,
			...(totalTokens !== undefined && { tokenCount: totalTokens }),
		};
		messages.push(resultMessage);

		await fs.writeFile(
			path.join(resultsPath, 'transcript.json'),
			JSON.stringify({ prompt, promptTokenCount: 0, promptCost: 0, messages }, null, 2),
		);

		await runHook('post-execute-agent', trialArgs);
		log.stop(isError ? 'Codex CLI completed with errors' : 'Codex CLI completed');

		return {
			agent: 'Codex CLI',
			model: codexModel,
			...(estimatedCost !== undefined && { cost: estimatedCost }),
			duration: Math.round(elapsedMs / 1000),
			durationApi: Math.round(elapsedMs / 1000),
			turns: numTurns,
		};
	},
};
