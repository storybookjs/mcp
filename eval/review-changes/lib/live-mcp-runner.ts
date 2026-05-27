/**
 * E2E live-MCP runner.
 *
 * Spawns the `claude` CLI with `--mcp-config` pointing at a Storybook
 * dev server's MCP endpoint, hands the agent a task prompt, and lets it
 * edit files in a target repo + call `get-changed-stories` and
 * `display-review` for real. Captures:
 *   - the full stream-json transcript (assistant turns + tool_use + tool_result)
 *   - token usage + cost from the final `result` event
 *   - the `display-review` payload, pulled out of the matching `tool_use`
 *   - the diff git observed after the run, before the reset
 *
 * Working-tree contract: the target repo MUST be clean (no modified /
 * staged / untracked files) before `runLiveMcpOnce` is called — that's
 * the only way the captured `git diff HEAD` after the agent is
 * unambiguously the agent's change. The caller (`pnpm capture`) enforces
 * this precondition up front, before any output or spawn; this runner
 * assumes it holds. No stashing, no re-apply gymnastics.
 *
 * Teardown is then trivial:
 *   - default: revert agent edits (`git checkout -- . && git clean -fd`)
 *     + kill the spawned Storybook.
 *   - `--keep-changes`: leave the agent's edits AND Storybook in place
 *     so the user can browse the captured feature live; print cleanup
 *     commands at the end.
 */
import { x } from 'tinyexec';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as v from 'valibot';
import { CLAUDE_MODEL_MAP } from '../../types.ts';
import { computeCascade } from './compute-cascade.ts';
import { openLiveLog, type LiveLog } from './live-log.ts';
import { formatPreflightFailure, preflightMcp } from './mcp-preflight.ts';
import { restorePristineTarget, type PristineResult } from './pristine-target.ts';
import { dim } from './term.ts';
import {
	ReviewStateSchema,
	StoryIndexSchema,
	type CascadeNode,
	type ChangedStory,
	type ReviewState,
	type StoryIndex,
} from './schema.ts';
import {
	cleanOldMcpConfigs,
	killStorybook,
	restartStorybook,
	type RestartResult,
} from './storybook-lifecycle.ts';

const MCP_SERVER_NAME = 'storybook';

export interface LiveMcpOptions {
	cwd: string;
	storybookUrl: string;
	task: string;
	model?: string;
	verbose?: boolean;
	/** Hard ceiling on the claude subprocess. Default 5 min. */
	timeoutMs?: number;
	/**
	 * Append a tail-friendly pretty log of every stream-json event to this
	 * file as the agent runs. Useful for `tail -f` from another shell
	 * while the run is in flight. The canonical machine-readable
	 * transcript is still written to the run record at the end.
	 */
	liveLogPath?: string;
	/**
	 * Override for the Storybook spawn command. Default:
	 * `npx storybook dev --port <port from storybookUrl> --no-open`.
	 */
	storybookCmd?: string;
	/**
	 * Override for the dependency-reconcile command run before each
	 * capture. Default: auto-detected from the target's lockfile
	 * (`yarn install --immutable`, `npm ci`, …).
	 */
	installCmd?: string;
	/**
	 * Skip the dependency reconcile (build caches are still cleared).
	 * Use only when you know the target's `node_modules` is already in
	 * sync with its lockfile — otherwise a stale tree silently corrupts
	 * the run.
	 */
	skipInstall?: boolean;
	/** Where to write the spawned Storybook's stdout/stderr. */
	storybookLogPath?: string;
	/**
	 * If true: skip the default teardown entirely. Leave the agent's
	 * edits in the target repo and leave Storybook running so the user
	 * can browse the captured feature live. The user runs the cleanup
	 * commands themselves when they're done (the CLI prints them).
	 *
	 * Default: false (clean teardown — revert agent edits via `git
	 * checkout -- . && git clean -fd`, kill the spawned Storybook,
	 * target repo ends exactly as it started).
	 */
	keepChanges?: boolean;
}

export interface LiveMcpResult {
	pushedReviewState?: ReviewState;
	rawText: string;
	transcript: unknown[];
	/** Uncached new input tokens (small under prompt caching — see cache fields). */
	inputTokens?: number;
	outputTokens?: number;
	/** Tokens written to the prompt cache this run (billed ~1.25x input). */
	cacheCreationTokens?: number;
	/** Tokens served from the prompt cache (billed ~0.1x input) — usually the bulk. */
	cacheReadTokens?: number;
	costUsd?: number;
	/** Diff git observed after the run, before the (optional) revert. */
	agentDiff: string;
	agentChangedFiles: string[];
	/**
	 * Snapshot of the target's Storybook environment, taken after the
	 * agent ran (and before teardown reverts its edits): the full story
	 * index from `<storybookUrl>/index.json`, plus the cascade
	 * (`computeCascade`) of the agent's changed files. This is what makes
	 * a capture *gradeable* — the cascade depths are the ground truth the
	 * `kind`/purity graders compare the agent's collections against. Absent
	 * if the snapshot failed (e.g. Storybook crashed mid-run).
	 */
	storyIndex?: StoryIndex;
	changedStories?: ChangedStory[];
	cascade?: CascadeNode[];
	mcpConfigPath: string;
	/** Set when we restarted Storybook for this capture. */
	storybookRestart?: RestartResult;
	/** Build caches cleared + dependency reconcile done before the run. */
	pristine?: PristineResult;
	/** Old temp MCP config files we cleaned up at the start. */
	cleanedMcpConfigs: number;
	/** Set if we killed Storybook on teardown (default mode, not --keep-changes). */
	storybookKilled?: boolean;
	/** True when --keep-changes was active: storybook + agent edits left in place. */
	keptChanges?: boolean;
	/** Tool names actually called by the agent (deduped, in order seen). */
	toolsCalled: string[];
	/**
	 * Tool calls that came back with `is_error: true`. Paired by
	 * `tool_use_id` so the name is reliable. Useful for surfacing
	 * silent failures like `mcp__storybook__get-changed-stories`
	 * returning 500 — the agent often keeps going and fabricates a
	 * payload from its memory, hiding the failure.
	 */
	toolErrors: ToolError[];
	/**
	 * Tool results too large for Claude Code's MCP output cap — spilled to
	 * a file so the agent only saw a pointer. Each entry records the
	 * tool and the original (pre-spill) size.
	 */
	fileSpills: FileSpill[];
	/**
	 * Per-tool roll-up of result text size — the dominant token cost of a
	 * run. Sorted heaviest first.
	 */
	toolStats: ToolStat[];
	/**
	 * Set when the agent run failed (e.g. timeout, subprocess crash) but
	 * we still captured partial data — transcript, diff, possibly the
	 * pushed payload. The caller can still write a record with whatever
	 * we got, instead of losing everything to a thrown exception.
	 *
	 * Preflight and clean-target failures still throw (no point continuing).
	 */
	error?: string;
}

export interface ToolError {
	name: string;
	error: string;
}

export interface FileSpill {
	tool: string;
	originalChars: number;
	originalLines?: number;
	spillPath?: string;
}

export interface ToolStat {
	tool: string;
	calls: number;
	resultChars: number;
	resultTokensEst: number;
}

export function buildLiveMcpSystemPrompt(): string {
	return [
		'You are a UI engineer working in a real codebase.',
		'',
		'CRITICAL: Call all tools — including the Storybook MCP tools — DIRECTLY yourself.',
		'Do NOT delegate to sub-agents (do not use the `Agent` / `Task` tool). Sub-agents',
		'get a fresh context without the Storybook MCP server attached, so they cannot call',
		'`get-changed-stories` or `display-review` and the whole run breaks.',
		'',
		'Workflow:',
		'1. Make the requested code change using your file-editing tools (Read, Edit, Write, Grep, etc.).',
		'2. Run `git status` and `git diff --name-only HEAD` (Bash) to confirm exactly which',
		'   files git sees as modified, added, or deleted after your edits. This list is the',
		'   ground truth for `changedFiles` in step 4.',
		'3. Call the Storybook MCP tool `mcp__storybook__get-changed-stories` directly (no arguments).',
		'   If it errors on the first call (e.g. HTTP 500 — common right after edits because',
		'   Storybook is mid-recompile), run `sleep 5` via Bash and retry ONCE. Most of these',
		'   errors resolve in seconds. If the second call also errors, note that explicitly in',
		'   the description and label your collections as inferred-without-cascade — do NOT',
		'   silently fabricate story IDs as if the cascade succeeded.',
		'4. Call the Storybook MCP tool `mcp__storybook__display-review` directly, exactly once, with:',
		'   - title: a PR-style title for the change — short and specific.',
		'   - description: a one-line summary of what changed and where to start reviewing.',
		'     If `get-changed-stories` errored, say so here.',
		'   - collections: titled groups of representative story IDs. Give each a concise,',
		'     PR-dense `title`, and set `kind` to "atomic" (the directly changed component),',
		'     "consumer" (direct dependents), "transitive" (pages/containers further down the',
		'     graph), or "catch-all" otherwise, plus a one-sentence rationale and a',
		'     `storyIds` array — representatives, not the whole membership.',
		'   - changedFiles: MUST exactly match the list from step 2. Include EVERY path',
		'     `git status` showed — modified, added, deleted — INCLUDING lockfiles',
		'     (package.json, yarn.lock, pnpm-lock.yaml, package-lock.json) and files you',
		'     deleted entirely. Under-reporting silently misleads reviewers about the',
		'     true scope of the change.',
		'   - diffHunks: one entry per file in `changedFiles`. For each path, use',
		'     `git diff HEAD -- <path>` (Bash) to get the exact unified-diff text and put',
		'     it in the `hunk` field. For deleted files, include the full deletion hunk.',
		'5. In your final reply, include the returned reviewUrl so the user can open it.',
		'',
		'Group aggressively. A long-tail cascade should still produce a small number of',
		'meaningful collections, each represented by a handful of story IDs.',
		'',
		'Always call `display-review` once, even if:',
		'  - `get-changed-stories` returns zero stories (e.g. theme-token changes delivered',
		'    at runtime — reason from the diff directly and surface representative stories),',
		'  - `get-changed-stories` errors entirely (push with `cascade unavailable` framing),',
		'  - the change has no visual impact (e.g. type-only changes, internal refactors —',
		'    push a single collection with `kind: catch-all` and a rationale saying so).',
		'The user always needs the review surface, even when the review is "nothing to see".',
	].join('\n');
}

function buildPrompt(task: string): string {
	return [buildLiveMcpSystemPrompt(), '', `TASK: ${task}`].join('\n');
}

/**
 * Detect Claude Code's "MCP tool result too large" spill. When an MCP
 * tool returns more text than the client's `MAX_MCP_OUTPUT_TOKENS` cap,
 * Claude Code writes the full result to a file and hands the model only
 * a short pointer string instead. addon-mcp never knows it happened — so
 * we recover the original size from that pointer string for post-mortem.
 * Returns undefined when the text is an ordinary (non-spilled) result.
 */
export function detectFileSpill(
	text: string,
): { originalChars: number; originalLines?: number; spillPath?: string } | undefined {
	if (!/exceeds (?:the )?maximum allowed tokens/i.test(text)) return undefined;
	const size = text.match(/\(([\d,]+)\s*characters?(?:\s+across\s+([\d,]+)\s*lines?)?\)/i);
	const pathM = text.match(/saved to (\S+?\.txt)/i);
	const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : undefined);
	return {
		originalChars: num(size?.[1]) ?? text.length,
		originalLines: num(size?.[2]),
		spillPath: pathM?.[1],
	};
}

async function gitResetWorking(cwd: string): Promise<void> {
	await x('git', ['-C', cwd, 'checkout', '--', '.'], { nodeOptions: { stdio: 'pipe' } });
	await x('git', ['-C', cwd, 'clean', '-fd'], { nodeOptions: { stdio: 'pipe' } });
}

async function gitDiff(cwd: string): Promise<{ diff: string; changedFiles: string[] }> {
	// `git diff HEAD` ignores untracked files, so a capture would lose any
	// files the agent newly created (e.g. a Zustand store added during a
	// Redux→Zustand migration). To make the diff a complete, replayable
	// patch, mark untracked files as "intent to add" before diffing — that
	// makes `git diff HEAD` emit them as additions — then immediately
	// `git reset` to drop the intent. The files stay untracked on disk
	// (visible to `clean -fd` in the finally block).
	const untrackedRaw = await x('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard'], {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
	});
	const untrackedFiles = String(untrackedRaw.stdout ?? '')
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);

	if (untrackedFiles.length > 0) {
		await x('git', ['-C', cwd, 'add', '--intent-to-add', '--', ...untrackedFiles], {
			nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
		});
	}

	try {
		// `--no-renames`: git's rename detection collapses a rename pair
		// (or a delete + a similar new file) into a single entry under the
		// new path. That undercounts the change — a `Badge → Pill` rename
		// shows only `Pill.tsx`, never `Badge.tsx` — and makes the agent's
		// own `changedFiles` (which lists both) look wrong against git.
		// Decomposing renames into delete + add keeps the captured diff and
		// the file list honest, and the delete+add patch replays cleanly.
		const d = await x('git', ['-C', cwd, 'diff', '--no-renames', '--unified=3', 'HEAD'], {
			nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
		});
		const f = await x('git', ['-C', cwd, 'diff', '--no-renames', '--name-only', 'HEAD'], {
			nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
		});
		const changedFiles = String(f.stdout ?? '')
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		return { diff: String(d.stdout ?? ''), changedFiles };
	} finally {
		if (untrackedFiles.length > 0) {
			// Drop the intent-to-add marks so `git clean -fd` later sees the
			// files as plain untracked and removes them along with the rest.
			try {
				await x('git', ['-C', cwd, 'reset', '--', ...untrackedFiles], {
					nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
				});
			} catch {
				// best-effort
			}
		}
	}
}

export async function runLiveMcpOnce(options: LiveMcpOptions): Promise<LiveMcpResult> {
	const model = options.model ?? 'claude-sonnet-4.6';
	const modelFlag = (CLAUDE_MODEL_MAP as Record<string, string>)[model];
	if (!modelFlag) {
		throw new Error(
			`Model "${model}" is not in CLAUDE_MODEL_MAP. Use one of: ${Object.keys(CLAUDE_MODEL_MAP).join(', ')}`,
		);
	}
	const timeoutMs = options.timeoutMs ?? 300_000;
	const log = (msg: string) => {
		if (options.verbose) console.error(`${dim('[live-mcp]')} ${msg}`);
	};

	// Pre-run cleanup — keep each capture as deterministic as possible.
	// (1) Delete temp MCP configs from previous runs (24h+ old).
	const cleanedMcpConfigs = await cleanOldMcpConfigs().catch(() => 0);
	if (cleanedMcpConfigs > 0) log(`cleaned ${cleanedMcpConfigs} old mcp config tempfiles`);

	// (2) Make the target pristine. The caller (`pnpm capture`) has
	// already enforced a clean working tree before reaching here. But the
	// teardown only restores tracked files, so a previous run that
	// changed dependencies leaves `node_modules` out of sync with the
	// restored lockfile, and stale Storybook/Vite caches can serve
	// modules from a different run. Reconcile both before spending money.
	let pristine: PristineResult | undefined;
	try {
		pristine = await restorePristineTarget({
			cwd: options.cwd,
			installCmd: options.installCmd,
			skipInstall: options.skipInstall,
			onProgress: (m) => log(`[pristine] ${m}`),
		});
	} catch (e) {
		throw new Error(`Pristine target restore failed: ${(e as Error).message}`);
	}

	// (3) Restart Storybook so the agent runs against a fresh dev server.
	// This is where the recurring 500s on /index.json get prevented — a
	// long-running Storybook accumulates Vite/HMR state across capture
	// cycles and eventually starts returning 500 on the story index.
	// Unconditional by design: skipping this is the kind of "ah I'll just
	// use what's running" shortcut that silently produces wrong cascades.
	let storybookRestart: RestartResult;
	try {
		storybookRestart = await restartStorybook({
			cwd: options.cwd,
			storybookUrl: options.storybookUrl,
			storybookCmd: options.storybookCmd,
			logPath: options.storybookLogPath ?? path.join(os.tmpdir(), `storybook-${Date.now()}.log`),
			onProgress: (m) => log(`[storybook-restart] ${m}`),
		});
		log(
			`storybook restarted in ${(storybookRestart.totalMs / 1000).toFixed(1)}s (pid=${storybookRestart.pid ?? '?'}, log=${storybookRestart.logPath})`,
		);
	} catch (e) {
		throw new Error(`Storybook restart failed: ${(e as Error).message}`);
	}

	// Preflight the MCP endpoint before doing anything destructive. Cheap
	// (one POST, no agent spawn) and confirms the storybook we just (re)
	// started is actually serving the tools we need.
	log(`preflighting MCP at ${options.storybookUrl}/mcp …`);
	const preflight = await preflightMcp(options.storybookUrl);
	if (!preflight.ok) {
		throw new Error(formatPreflightFailure(preflight));
	}
	log(
		`preflight ok — ${preflight.totalTools} tools, required present: get-changed-stories, display-review`,
	);

	const mcpConfigPath = path.join(os.tmpdir(), `review-mcp-config-${Date.now()}.json`);
	const mcpConfig = {
		mcpServers: {
			[MCP_SERVER_NAME]: {
				type: 'http',
				url: options.storybookUrl.replace(/\/$/, '') + '/mcp',
			},
		},
	};
	await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
	log(`mcp config → ${mcpConfigPath}`);

	const prompt = buildPrompt(options.task);

	const args = [
		'--print',
		'--dangerously-skip-permissions',
		'--output-format=stream-json',
		'--verbose',
		'--mcp-config',
		mcpConfigPath,
		'--strict-mcp-config',
		// Forbid two tools that are wrong for headless capture mode:
		//   - Agent: sub-agents spawned via this tool do NOT inherit `--mcp-config`,
		//     so they cannot call our `mcp__storybook__*` tools. Silent failure.
		//   - AskUserQuestion: there is no user to answer in this subprocess.
		//     Every call comes back as "Answer questions?" which the agent
		//     interprets as failure and either retries (wasted tokens) or
		//     gives up. Either way, it never produces useful output.
		'--disallowed-tools',
		'Agent,AskUserQuestion',
		'--model',
		modelFlag,
		prompt,
	];
	log(`spawning claude --model ${modelFlag} (cwd=${options.cwd})`);

	let proc: ReturnType<typeof x> | undefined;
	const assistantTextChunks: string[] = [];
	const transcript: unknown[] = [];
	const toolsCalled: string[] = [];
	const toolNameById = new Map<string, string>();
	const toolErrors: ToolError[] = [];
	const fileSpills: FileSpill[] = [];
	/** tool name → { calls, total result chars } — rolled into toolStats at the end. */
	const toolResultAgg = new Map<string, { calls: number; chars: number }>();
	let pushed: ReviewState | undefined;
	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let cacheCreationTokens: number | undefined;
	let cacheReadTokens: number | undefined;
	let costUsd: number | undefined;
	let agentDiff = '';
	let agentChangedFiles: string[] = [];
	let storyIndex: StoryIndex | undefined;
	let changedStories: ChangedStory[] | undefined;
	let cascade: CascadeNode[] | undefined;
	let storybookKilled = false;
	let liveLog: LiveLog | undefined;
	if (options.liveLogPath) {
		liveLog = openLiveLog(options.liveLogPath);
		log(`live log → ${options.liveLogPath}`);
	}

	let runError: string | undefined;
	try {
		proc = x('claude', args, {
			nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'], cwd: options.cwd },
		});

		const procPromise = (async () => {
			for await (const line of proc!) {
				if (!line.trim()) continue;
				let msg: any;
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				transcript.push(msg);
				liveLog?.write(msg);
				if (msg.type === 'assistant' && msg.message?.content) {
					for (const block of msg.message.content) {
						if (block?.type === 'text' && typeof block.text === 'string') {
							assistantTextChunks.push(block.text);
						}
						if (block?.type === 'tool_use' && typeof block.name === 'string') {
							if (typeof block.id === 'string') toolNameById.set(block.id, block.name);
							if (!toolsCalled.includes(block.name)) {
								toolsCalled.push(block.name);
								log(`tool_use: ${block.name}`);
							}
							// Match both `display-review` and the MCP-namespaced
							// `mcp__<server>__display-review`.
							if (/display-review$/.test(block.name)) {
								const parsed = v.safeParse(ReviewStateSchema, block.input);
								if (parsed.success) {
									pushed = parsed.output;
									log('captured display-review payload');
								} else {
									log(
										`display-review payload did NOT validate: ${parsed.issues.map((i) => i.message).join('; ')}`,
									);
								}
							}
						}
					}
				} else if (msg.type === 'user' && msg.message?.content) {
					// `user` messages from Claude Code's stream carry tool_result blocks
					// back from the SDK. Measure every one — size (the dominant token
					// cost), errors, and file spills — so the CLI can surface them.
					for (const block of msg.message.content) {
						if (block?.type !== 'tool_result') continue;
						const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
						const name = toolNameById.get(id) ?? '<unknown tool>';
						const text = Array.isArray(block.content)
							? block.content
									.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c)))
									.join(' ')
							: typeof block.content === 'string'
								? block.content
								: JSON.stringify(block.content ?? '');

						// Per-tool result-size roll-up — the dominant token cost of a run.
						const agg = toolResultAgg.get(name) ?? { calls: 0, chars: 0 };
						agg.calls += 1;
						agg.chars += text.length;
						toolResultAgg.set(name, agg);

						// File spill: result too big for the client's MCP output cap, so
						// Claude Code wrote it to disk and gave the agent only a pointer.
						const spill = detectFileSpill(text);
						if (spill) {
							fileSpills.push({ tool: name, ...spill });
							log(
								`tool_result SPILLED (${name}): ${spill.originalChars} chars → ${spill.spillPath ?? 'file'}`,
							);
						}

						if (block.is_error === true) {
							toolErrors.push({ name, error: text.slice(0, 500).replace(/\s+/g, ' ').trim() });
							log(`tool_result ERROR (${name}): ${text.slice(0, 120)}`);
						}
					}
				} else if (msg.type === 'result') {
					inputTokens = msg.usage?.input_tokens;
					outputTokens = msg.usage?.output_tokens;
					cacheCreationTokens = msg.usage?.cache_creation_input_tokens;
					cacheReadTokens = msg.usage?.cache_read_input_tokens;
					costUsd = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined;
				}
			}
		})();

		try {
			await withTimeout(procPromise, timeoutMs, `claude subprocess exceeded ${timeoutMs}ms`);
		} catch (e) {
			runError = (e as Error).message;
			log(`run error: ${runError}`);
			// Kill the subprocess so it doesn't keep running past the cap.
			try {
				proc.process?.kill('SIGTERM');
				// Give it a moment, then SIGKILL if still alive.
				setTimeout(() => {
					try {
						proc!.process?.kill('SIGKILL');
					} catch {
						// already exited
					}
				}, 2000).unref();
			} catch {
				// proc.process might not be defined yet — best-effort
			}
		}

		// Capture the diff EVEN ON TIMEOUT. The agent may have already
		// made meaningful edits + tool calls; losing them to an exception
		// burns the whole spend.
		log('capturing post-run diff (agent edits) before reset');
		try {
			const captured = await gitDiff(options.cwd);
			agentDiff = captured.diff;
			agentChangedFiles = captured.changedFiles;
			log(
				`agent changed ${agentChangedFiles.length} files (${agentDiff.length} bytes of diff)` +
					(runError ? ' — partial (run errored)' : ''),
			);
		} catch (e) {
			log(`diff capture error: ${(e as Error).message}`);
		}

		// Snapshot the Storybook environment — the full story index and
		// the cascade of the agent's changed files — while the dev server
		// is still up and the edits are still on disk. This is what later
		// lets the graders judge whether the agent's collections are
		// *correct*: cascade depth is the ground truth for `kind`.
		log('snapshotting story index + cascade');
		try {
			const idxRes = await fetch(options.storybookUrl.replace(/\/$/, '') + '/index.json');
			if (!idxRes.ok) {
				log(`story index fetch returned HTTP ${idxRes.status}`);
			} else {
				const parsedIdx = v.safeParse(StoryIndexSchema, await idxRes.json());
				if (!parsedIdx.success) {
					log('story index did not match StoryIndexSchema — skipping cascade');
				} else {
					storyIndex = parsedIdx.output;
					if (agentChangedFiles.length > 0) {
						const c = await computeCascade(options.cwd, agentChangedFiles, storyIndex);
						changedStories = c.changedStories;
						cascade = c.cascade;
					}
					log(
						`story index: ${Object.keys(storyIndex.entries).length} entries, ` +
							`cascade: ${cascade?.length ?? 0} stories`,
					);
				}
			}
		} catch (e) {
			log(`story index snapshot error: ${(e as Error).message}`);
		}

		// Don't return here — let the finally complete first so teardown
		// state (storybookKilled, etc) is included in the returned record.
	} finally {
		await liveLog?.close();

		// Teardown — much simpler now that there's no stash to pop and no
		// diff to re-apply. Two branches:
		//
		//   default      → revert agent edits + kill spawned storybook
		//   --keep-changes → do literally nothing; leave agent edits + storybook
		//                    in place for the user to inspect. CLI footer
		//                    prints the cleanup commands.
		//
		// Steps are wrapped in per-step timeouts so a hanging `git` or kill
		// can't freeze the CLI; we log + continue on timeout.
		const teardownStep = async <T>(
			name: string,
			fn: () => Promise<T>,
			ms: number,
		): Promise<T | undefined> => {
			try {
				return await withTimeout(fn(), ms, `${name} exceeded ${ms}ms`);
			} catch (e) {
				log(`teardown step "${name}" failed: ${(e as Error).message}`);
				return undefined;
			}
		};

		if (options.keepChanges) {
			log('--keep-changes: leaving agent edits + storybook in place');
		} else {
			log('reverting agent edits: git checkout -- . && git clean -fd');
			await teardownStep('git checkout/clean', () => gitResetWorking(options.cwd), 30_000);
			if (storybookRestart) {
				log('killing storybook we spawned');
				const port = Number(new URL(options.storybookUrl).port);
				const killed = await teardownStep(
					'killStorybook',
					() => killStorybook(port, storybookRestart!.pid, (m) => log(`[kill-storybook] ${m}`)),
					15_000,
				);
				storybookKilled = killed?.killed ?? false;
			}
		}
		// Leave mcpConfigPath in $TMPDIR — useful for verbose post-mortem.
	}

	// Now that the finally block has run, teardown state (storybookKilled
	// in particular) is final. Build the result and return.
	return buildResult();

	function buildResult(): LiveMcpResult {
		const toolStats: ToolStat[] = [...toolResultAgg.entries()]
			.map(([tool, { calls, chars }]) => ({
				tool,
				calls,
				resultChars: chars,
				resultTokensEst: Math.round(chars / 4),
			}))
			.sort((a, b) => b.resultChars - a.resultChars);
		return {
			pushedReviewState: pushed,
			rawText: assistantTextChunks.join('').trim(),
			transcript,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
			costUsd,
			agentDiff,
			agentChangedFiles,
			storyIndex,
			changedStories,
			cascade,
			mcpConfigPath,
			toolsCalled,
			toolErrors,
			fileSpills,
			toolStats,
			storybookRestart,
			pristine,
			cleanedMcpConfigs,
			storybookKilled: options.keepChanges ? undefined : storybookKilled,
			keptChanges: options.keepChanges ? true : undefined,
			error: runError,
		};
	}
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	try {
		return await Promise.race([p, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
