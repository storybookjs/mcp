/**
 * Run the `claude` agent in *review-only* mode.
 *
 * Used by `replay-capture --review`: the UI change is already in the
 * target's working tree (replay-capture just applied it). The agent
 * must NOT touch code — it inspects the existing diff, calls
 * `get-changed-stories`, and pushes `apply-review-state`, which lands
 * live on Storybook's `/review-changes/` page.
 *
 * This is the review half of a capture, standalone. It deliberately
 * does far less than `runLiveMcpOnce`: no dependency reconcile, no
 * Storybook restart, no diff capture — the change is already applied
 * and the dev server is the caller's responsibility.
 */
import { x } from 'tinyexec';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as v from 'valibot';
import { CLAUDE_MODEL_MAP } from '../../types.ts';
import { ReviewStateSchema, type ReviewState } from './schema.ts';

const REVIEW_SYSTEM_PROMPT = [
	'You are a Storybook UI reviewer. A UI change has ALREADY been made and is',
	'present in the working tree of this repository. Review it — do NOT edit,',
	'write, create, or revert any code or files.',
	'',
	'CRITICAL: call every tool — including the Storybook MCP tools — directly',
	'yourself. Do NOT delegate to sub-agents.',
	'',
	'Workflow:',
	'1. Run `git status` and `git diff HEAD` (Bash) to see exactly what changed —',
	'   every modified, added, and deleted file.',
	'2. Call the Storybook MCP tool `mcp__storybook__get-changed-stories` directly',
	'   (no arguments). If it errors (HTTP 500 is common right after edits, while',
	'   Storybook recompiles), run `sleep 5` via Bash and retry ONCE. If it still',
	'   errors, say so in the description and label your collections as',
	'   inferred-without-cascade.',
	'3. Call the Storybook MCP tool `mcp__storybook__apply-review-state` directly,',
	'   exactly once, with:',
	'   - title: a PR-style title for the change — short and specific.',
	'   - description: a one-line summary — what changed and where to start reviewing.',
	'   - collections: titled groups of representative story IDs. Give each a concise,',
	'     PR-dense `title`, and set `kind` to "atomic" (the directly changed component),',
	'     "consumer" (direct dependents), "transitive" (pages/containers further down',
	'     the graph), or "catch-all" otherwise, plus a one-sentence rationale and a',
	'     `sampleStoryIds` array — representatives, not the whole membership.',
	'   - changedFiles: every path from step 1, including deletions and lockfiles.',
	'   - diffHunks: one entry per changed file — the unified-diff text.',
	'4. In your final reply, include the returned reviewUrl.',
].join('\n');

export interface ReviewAgentResult {
	pushedReviewState?: ReviewState;
	toolsCalled: string[];
	toolErrors: { name: string; error: string }[];
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	error?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

export async function runReviewAgent(opts: {
	/** Target repo — the change must already be in its working tree. */
	cwd: string;
	/** Running Storybook origin; its `/mcp` endpoint must serve the tools. */
	storybookUrl: string;
	model?: string;
	timeoutMs?: number;
	onProgress?: (msg: string) => void;
}): Promise<ReviewAgentResult> {
	const model = opts.model ?? 'claude-sonnet-4.6';
	const modelFlag = (CLAUDE_MODEL_MAP as Record<string, string>)[model];
	if (!modelFlag) {
		throw new Error(
			`Model "${model}" is not in CLAUDE_MODEL_MAP. Use one of: ${Object.keys(CLAUDE_MODEL_MAP).join(', ')}`,
		);
	}
	const timeoutMs = opts.timeoutMs ?? 600_000;
	const progress = opts.onProgress ?? (() => undefined);

	const mcpConfigPath = path.join(os.tmpdir(), `review-mcp-config-${Date.now()}.json`);
	await fs.writeFile(
		mcpConfigPath,
		JSON.stringify({
			mcpServers: {
				storybook: { type: 'http', url: opts.storybookUrl.replace(/\/$/, '') + '/mcp' },
			},
		}),
	);

	const args = [
		'--print',
		'--dangerously-skip-permissions',
		'--output-format=stream-json',
		'--verbose',
		'--mcp-config',
		mcpConfigPath,
		'--strict-mcp-config',
		// Review-only: no sub-agents (they lose the MCP config), no user
		// questions (headless), and no code-mutation tools — the agent
		// reviews what's there, it does not change it.
		'--disallowed-tools',
		'Agent,AskUserQuestion,Write,Edit,NotebookEdit',
		'--model',
		modelFlag,
		REVIEW_SYSTEM_PROMPT,
	];

	const toolsCalled: string[] = [];
	const toolNameById = new Map<string, string>();
	const toolErrors: { name: string; error: string }[] = [];
	let pushedReviewState: ReviewState | undefined;
	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let costUsd: number | undefined;
	let runError: string | undefined;

	const proc = x('claude', args, {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd },
	});

	const stream = (async () => {
		for await (const line of proc) {
			if (!line.trim()) continue;
			let msg: any;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
				for (const block of msg.message.content) {
					if (block?.type === 'tool_use' && typeof block.name === 'string') {
						if (typeof block.id === 'string') toolNameById.set(block.id, block.name);
						if (!toolsCalled.includes(block.name)) {
							toolsCalled.push(block.name);
							progress(`tool: ${block.name}`);
						}
						if (/apply-review-state$/.test(block.name)) {
							const parsed = v.safeParse(ReviewStateSchema, block.input);
							if (parsed.success) pushedReviewState = parsed.output;
						}
					}
				}
			} else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
				for (const block of msg.message.content) {
					if (block?.type === 'tool_result' && block.is_error === true) {
						const name = toolNameById.get(block.tool_use_id) ?? '<unknown tool>';
						const text = Array.isArray(block.content)
							? block.content
									.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c)))
									.join(' ')
							: String(block.content ?? '');
						toolErrors.push({ name, error: text.slice(0, 300).replace(/\s+/g, ' ').trim() });
					}
				}
			} else if (msg.type === 'result') {
				inputTokens = msg.usage?.input_tokens;
				outputTokens = msg.usage?.output_tokens;
				costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined;
			}
		}
	})();

	try {
		await withTimeout(stream, timeoutMs, `review agent exceeded ${timeoutMs}ms`);
	} catch (e) {
		runError = (e as Error).message;
		try {
			proc.process?.kill('SIGTERM');
			setTimeout(() => {
				try {
					proc.process?.kill('SIGKILL');
				} catch {
					// already exited
				}
			}, 2000).unref();
		} catch {
			// best-effort
		}
	}

	return { pushedReviewState, toolsCalled, toolErrors, inputTokens, outputTokens, costUsd, error: runError };
}
