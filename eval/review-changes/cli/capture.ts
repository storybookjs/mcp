#!/usr/bin/env node
/**
 * CLI: E2E capture — run the agent end-to-end against a real Storybook
 * with live MCP. The agent edits code, calls `get-changed-stories`, and
 * calls `apply-review-state`. We capture the transcript, the payload,
 * and the actual diff the agent made, then revert the agent's edits.
 *
 *   pnpm capture \
 *     --cwd /path/to/target \
 *     --storybook-url http://localhost:6010 \
 *     --task "Make the primary Button bolder" \
 *     --scenario <slug> \
 *     --model claude-sonnet-4.6 \
 *     --verbose
 */
import { program } from 'commander';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { x } from 'tinyexec';
import * as v from 'valibot';
import { runLiveMcpOnce } from '../lib/live-mcp-runner.ts';
import { writeRunRecordWithPayload } from '../lib/payload-extractor.ts';
import { classifyRun, gradeAll } from '../lib/graders.ts';
import { CAPTURES_DIR, rebuildRunsIndex, RUNS_INDEX_FILE } from '../lib/runs-index.ts';
import { ensureDir, payloadFilename, runRecordFilename, timestampSlug } from '../lib/paths.ts';
import { ReviewFixtureSchema, type ReviewFixture, type RunRecord } from '../lib/schema.ts';
import { bold, green, red, yellow } from '../lib/term.ts';

program
	.requiredOption('--cwd <dir>', 'target repo to run the agent in')
	.requiredOption('--task <text>', 'the task prompt to give the agent')
	.requiredOption(
		'--scenario <slug>',
		'capture name — artifacts go to review-changes/captures/<slug>/',
	)
	.option('--storybook-url <url>', 'running Storybook origin', 'http://localhost:6010')
	.option('--model <id>', 'model id', 'claude-sonnet-4.6')
	.option('--timeout <ms>', 'wall-clock cap on the agent run', '1500000')
	.option(
		'--storybook-cmd <cmd>',
		'command used to spawn the fresh Storybook (default: `npx storybook dev --port <port from --storybook-url> --no-open`)',
	)
	.option(
		'--install-cmd <cmd>',
		"command used to reconcile the target's dependencies before the run (default: auto-detected from the lockfile, e.g. `yarn install --immutable`)",
	)
	.option(
		'--skip-install',
		'skip the dependency reconcile (build caches are still cleared). Only safe when node_modules is already in sync with the lockfile.',
	)
	.option(
		'--force',
		'if the target working tree is dirty, reset it to pristine instead of refusing. DESTRUCTIVE — discards uncommitted work in the target.',
	)
	.option(
		'--keep-changes',
		"leave the agent's edits applied + Storybook running after the capture, so you can browse the feature live. Default is a clean teardown (revert + kill).",
	)
	.option('-v, --verbose', 'stream per-step progress');

program.parse();
const opts = program.opts<{
	cwd: string;
	task: string;
	scenario: string;
	storybookUrl: string;
	model: string;
	timeout: string;
	storybookCmd?: string;
	installCmd?: string;
	skipInstall?: boolean;
	force?: boolean;
	keepChanges?: boolean;
	verbose?: boolean;
}>();

const { storybookUrl, model } = opts;
const cwdAbs = path.resolve(opts.cwd);

// Precondition — checked before any output, directory creation, or
// spawn: the target working tree must be clean, so the captured
// `git diff HEAD` after the agent is unambiguously the agent's change.
// Fail fast and quiet when it isn't.
{
	const st = await x('git', ['-C', cwdAbs, 'status', '--porcelain'], {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
	});
	if (st.exitCode !== 0) {
		console.error(red(`✗ Cannot check the target — \`git status\` failed in ${cwdAbs}.`));
		console.error(`  Is it a git repository? ${String(st.stderr ?? '').trim()}`);
		process.exit(1);
	}
	const dirty = String(st.stdout ?? '')
		.split('\n')
		.map((s) => s.trimEnd())
		.filter(Boolean);
	if (dirty.length > 0) {
		if (opts.force) {
			console.log(
				yellow(`⚠ --force: discarding ${dirty.length} uncommitted change(s) in ${cwdAbs}:`),
			);
			for (const line of dirty.slice(0, 20)) console.log(`    ${line}`);
			if (dirty.length > 20) console.log(`    … and ${dirty.length - 20} more`);
			await x('git', ['-C', cwdAbs, 'checkout', '--', '.'], { nodeOptions: { stdio: 'pipe' } });
			await x('git', ['-C', cwdAbs, 'clean', '-fd'], { nodeOptions: { stdio: 'pipe' } });
			console.log('');
		} else {
			console.error(
				bold(red(`✗ Target repo is dirty — refusing to run (nothing spawned, no cost).`)),
			);
			console.error(``);
			console.error(`  ${cwdAbs}`);
			console.error(``);
			for (const line of dirty.slice(0, 20)) console.error(`  ${line}`);
			if (dirty.length > 20) console.error(`  … and ${dirty.length - 20} more`);
			console.error(``);
			console.error(bold(`Resolve (any of):`));
			console.error(
				`  commit it:               git -C ${cwdAbs} add . && git -C ${cwdAbs} commit -m '…'`,
			);
			console.error(
				`  discard it:              git -C ${cwdAbs} checkout -- . && git -C ${cwdAbs} clean -fd`,
			);
			console.error(`  let capture discard it:  re-run with --force`);
			process.exit(1);
		}
	}
}

const outAbs = path.resolve(CAPTURES_DIR, opts.scenario);
await ensureDir(outAbs);

const baseCommitR = await x('git', ['-C', cwdAbs, 'rev-parse', 'HEAD'], {
	nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
});
const baseCommit = String(baseCommitR.stdout ?? '').trim();

const startedAt = new Date();
const ts = timestampSlug(startedAt);
const modelSlug = model.replace(/[^a-zA-Z0-9._-]/g, '_');
const scenarioId = opts.scenario;

// Pin the base commit with a permanent git tag. A raw SHA can be GC'd
// after the user rebases or amends in the target — the tag guarantees
// `replay-capture` can always reproduce the exact state the agent saw.
const baseTag = `eval-base/${scenarioId}/${ts}`;
let baseTagWritten = false;
try {
	const tagR = await x('git', ['-C', cwdAbs, 'tag', '-f', baseTag, baseCommit], {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
	});
	baseTagWritten = (tagR.exitCode ?? 1) === 0;
} catch {
	baseTagWritten = false;
}
const recordAbs = path.join(outAbs, `${ts}--${modelSlug}.json`);
const payloadAbs = path.join(outAbs, `${ts}--${modelSlug}.payload.json`);
const diffAbs = path.join(outAbs, `${ts}--${modelSlug}.agent.diff`);
const liveLogAbs = path.join(outAbs, `${ts}--${modelSlug}.live.log`);
const storybookLogAbs = path.join(outAbs, `${ts}--${modelSlug}.storybook.log`);

console.log(bold('E2E capture (live MCP)'));
console.log(`  scenario:      ${scenarioId}`);
console.log(`  target repo:   ${cwdAbs}`);
console.log(`  storybook:     ${storybookUrl}`);
console.log(`  task:          ${opts.task}`);
console.log(`  model:         ${model}`);
console.log(`  out:           ${outAbs}`);
console.log(`  baseCommit:    ${baseCommit}`);
console.log('');
console.log(bold('Live agent log') + ' (tail -f to follow while the run is in flight):');
console.log(`  ${liveLogAbs}`);
console.log(bold('Storybook stdout/stderr') + ' (fresh process spawned for this run):');
console.log(`  ${storybookLogAbs}`);
console.log('');

const t0 = Date.now();

let result: Awaited<ReturnType<typeof runLiveMcpOnce>> | undefined;
let error: string | undefined;
try {
	result = await runLiveMcpOnce({
		cwd: cwdAbs,
		storybookUrl: storybookUrl,
		task: opts.task,
		model: model,
		verbose: opts.verbose,
		timeoutMs: Number(opts.timeout),
		liveLogPath: liveLogAbs,
		storybookCmd: opts.storybookCmd,
		storybookLogPath: storybookLogAbs,
		installCmd: opts.installCmd,
		skipInstall: opts.skipInstall,
		keepChanges: opts.keepChanges,
	});
	// Preflight throws; other failures (timeout, subprocess crash) come
	// back on the result so we keep the partial transcript + diff.
	if (result.error) error = result.error;
} catch (e) {
	error = e instanceof Error ? e.message : String(e);
}

const finishedAt = new Date();
const recordName = runRecordFilename(ts, model);
const payloadName = payloadFilename(ts, model);

const prompt = `[live-mcp E2E] ${opts.task}`;
const promptVersion = `sha-${createHash('sha256').update(prompt).digest('hex').slice(0, 8)}`;

const captureSource = {
	repoPath: cwdAbs,
	baseCommit,
	baseTag: baseTagWritten ? baseTag : undefined,
	workingTreeDirty: false,
	storybookUrl: storybookUrl,
};

// Synthesise a fixture-shaped object for the grader so we can score
// schema validity / collection purity / kind correctness / etc. There is
// no human-authored fixture for an E2E capture — but the runner
// snapshotted the live story index + cascade after the agent ran, so
// the cascade-derived graders have real ground truth to grade against.
const syntheticFixture: ReviewFixture = v.parse(ReviewFixtureSchema, {
	scenarioId,
	recordedAt: startedAt.toISOString(),
	taskFraming: opts.task,
	diff: result?.agentDiff ?? '',
	changedFiles: result?.agentChangedFiles ?? [],
	diffHunks: [],
	storyIndex: result?.storyIndex ?? { entries: {} },
	changedStories: result?.changedStories ?? [],
	cascade: result?.cascade,
	groundTruth: {},
	source: captureSource,
});

const scores = gradeAll(result?.pushedReviewState, syntheticFixture);
const status = classifyRun({
	error,
	schemaValid: scores.schemaValid,
	hasPushed: !!result?.pushedReviewState,
});

const record: RunRecord = {
	scenarioId,
	model: model,
	agent: 'claude-code (live MCP)',
	driver: 'live-mcp',
	status,
	prompt,
	promptVersion,
	task: opts.task,
	startedAt: startedAt.toISOString(),
	finishedAt: finishedAt.toISOString(),
	latencyMs: Date.now() - t0,
	inputTokens: result?.inputTokens,
	outputTokens: result?.outputTokens,
	cacheCreationTokens: result?.cacheCreationTokens,
	cacheReadTokens: result?.cacheReadTokens,
	costUsd: result?.costUsd,
	pushedReviewState: result?.pushedReviewState,
	scores: scores as unknown as Record<string, unknown>,
	rawText: result?.rawText,
	transcript: result?.transcript,
	agentDiff: result?.agentDiff,
	agentChangedFiles: result?.agentChangedFiles,
	storyIndex: result?.storyIndex,
	changedStories: result?.changedStories,
	cascade: result?.cascade,
	toolErrors: result?.toolErrors,
	fileSpills: result?.fileSpills,
	toolStats: result?.toolStats,
	storybookRestart: result?.storybookRestart,
	keptChanges: result?.keptChanges,
	storybookKilled: result?.storybookKilled,
	source: captureSource,
	error,
};

await writeRunRecordWithPayload(outAbs, recordName, record);
await fs.writeFile(diffAbs, result?.agentDiff ?? '');
// Write a stable `latest.payload.json` so the most recent ReviewState
// always has a fixed path — the artifact to hand to a frontend engineer.
// (No `latest.json` full-record copy: run selection goes through
// .runs-index.json, which is derived and can't drift out of sync.)
if (record.pushedReviewState) {
	await fs.writeFile(
		path.join(outAbs, 'latest.payload.json'),
		JSON.stringify(record.pushedReviewState, null, 2),
	);
}
await rebuildRunsIndex().catch((e) => {
	console.warn(`(warning) runs-index rebuild failed: ${(e as Error).message}`);
});

console.log('');
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(
	error
		? bold(red(`✗ Capture failed (${elapsed}s)`))
		: bold(green(`✓ Capture complete (${elapsed}s)`)),
);
const statusColor = status === 'ok' ? green : status === 'timeout' ? yellow : red;
console.log(`  status:     ${statusColor(status)}`);
console.log(`  record:     ${recordAbs}`);
if (record.pushedReviewState) {
	console.log(`  payload:    ${payloadAbs}`);
} else {
	// Three distinct shapes of "no payload" — be specific about which one
	// so the user knows whether to retry, restructure, or debug.
	const calledApplyReviewState = !!result?.toolsCalled.some((n) => /apply-review-state$/.test(n));
	let why: string;
	if (calledApplyReviewState) {
		why =
			'(agent CALLED apply-review-state but the payload was rejected — see ⚠ tool errors below for the schema failure)';
	} else if (error) {
		why = `(agent NEVER called apply-review-state — run errored before report phase: ${error.split('\n')[0]})`;
	} else if (result?.toolsCalled.length) {
		why = `(agent NEVER called apply-review-state — ran for ${(record.latencyMs / 1000).toFixed(0)}s using ${result.toolsCalled.length} other tools but never reached the report step; task may be too large to fit one round-trip)`;
	} else {
		why = '(none — no agent activity recorded)';
	}
	console.log(`  payload:    ${why}`);
}
if (result) {
	console.log(`  agent diff: ${diffAbs} (${result.agentChangedFiles.length} files)`);
	console.log(
		`  cost:       ${result.costUsd != null ? '$' + result.costUsd.toFixed(4) : '? (no result event — likely killed by timeout)'}`,
	);
	{
		const inNew = result.inputTokens;
		const cw = result.cacheCreationTokens;
		const cr = result.cacheReadTokens;
		if (inNew == null && cw == null && cr == null) {
			console.log(`  tokens:     ? (no result event — likely killed by timeout)`);
		} else {
			const totalIn = (inNew ?? 0) + (cw ?? 0) + (cr ?? 0);
			console.log(
				`  tokens:     ${totalIn.toLocaleString()} in · ${(result.outputTokens ?? 0).toLocaleString()} out`,
			);
		}
	}
	console.log(`  tools used: ${result.toolsCalled.join(', ') || '(none)'}`);
	if (result.storyIndex) {
		console.log(
			`  cascade:    ${result.cascade?.length ?? 0} stories affected ` +
				`(of ${Object.keys(result.storyIndex.entries).length} in the index)`,
		);
	}
	if (result.cleanedMcpConfigs > 0) {
		console.log(
			`  cleaned:    ${result.cleanedMcpConfigs} old /tmp/review-mcp-config-*.json file${result.cleanedMcpConfigs === 1 ? '' : 's'}`,
		);
	}
	if (result.toolErrors.length > 0) {
		console.log('');
		console.log(
			yellow(
				`⚠ ${result.toolErrors.length} tool call${result.toolErrors.length === 1 ? '' : 's'} returned an error — the agent may have continued with degraded data:`,
			),
		);
		for (const te of result.toolErrors) {
			const msg = te.error.length > 160 ? te.error.slice(0, 159) + '…' : te.error;
			console.log(`  ${yellow('⚠')} ${te.name}: ${msg}`);
		}
	}

	if (result.fileSpills.length > 0) {
		console.log('');
		console.log(
			yellow(
				`⚠ ${result.fileSpills.length} tool result${result.fileSpills.length === 1 ? '' : 's'} spilled to a file — too large for the agent's context cap, so it saw only a pointer and read the result back partially (likely missing the tail):`,
			),
		);
		for (const s of result.fileSpills) {
			console.log(
				`  ${yellow('⚠')} ${s.tool}: ${s.originalChars.toLocaleString()} chars` +
					(s.originalLines ? ` / ${s.originalLines.toLocaleString()} lines` : '') +
					(s.spillPath ? ` → ${s.spillPath}` : ''),
			);
		}
	}

	if (result.toolStats.length > 0) {
		console.log('');
		console.log(
			bold('Tool-result token weight') + ' (text each tool pushed back into the agent context):',
		);
		for (const t of result.toolStats.slice(0, 8)) {
			console.log(
				`  ${t.tool.padEnd(38)} ${String(t.calls).padStart(2)} call${t.calls === 1 ? ' ' : 's'}  ` +
					`${t.resultChars.toLocaleString().padStart(10)} chars  ~${t.resultTokensEst.toLocaleString()} tok`,
			);
		}
	}

	// changedFiles delta: payload vs git. Only surfaced when the two
	// disagree — a perfect match is the boring case, not worth the noise.
	const payloadFiles = new Set<string>(record.pushedReviewState?.changedFiles ?? []);
	const gitFiles = new Set<string>(result.agentChangedFiles);
	{
		const inter = [...gitFiles].filter((f) => payloadFiles.has(f));
		const missingFromPayload = [...gitFiles].filter((f) => !payloadFiles.has(f));
		const onlyInPayload = [...payloadFiles].filter((f) => !gitFiles.has(f));
		const union = new Set([...payloadFiles, ...gitFiles]);
		const jaccard = union.size === 0 ? 1 : inter.length / union.size;
		if (jaccard !== 1) {
			const accuracyPct = (jaccard * 100).toFixed(0) + '%';
			console.log('');
			console.log(bold('changedFiles delta') + ' (payload vs git):');
			console.log(`  payload reports: ${payloadFiles.size}`);
			console.log(`  git observed:    ${gitFiles.size}`);
			console.log(`  accuracy:        ${yellow(accuracyPct)}`);
			if (missingFromPayload.length > 0) {
				console.log(yellow(`  ⚠ in git, missing from payload (${missingFromPayload.length}):`));
				for (const f of missingFromPayload.slice(0, 10)) console.log(`      - ${f}`);
				if (missingFromPayload.length > 10)
					console.log(`      … and ${missingFromPayload.length - 10} more`);
			}
			if (onlyInPayload.length > 0) {
				console.log(yellow(`  ⚠ in payload, not in git (${onlyInPayload.length}):`));
				for (const f of onlyInPayload.slice(0, 10)) console.log(`      - ${f}`);
				if (onlyInPayload.length > 10) console.log(`      … and ${onlyInPayload.length - 10} more`);
			}
		}
	}
}
console.log('');
console.log(`  index:      ${path.resolve(RUNS_INDEX_FILE)}`);

console.log('');
const reviewUrl = storybookUrl.replace(/\/$/, '') + '/?path=/review-changes/';
if (opts.keepChanges) {
	const port = new URL(storybookUrl).port;
	console.log(
		bold('Teardown: --keep-changes') + ' — agent edits left in place, Storybook still running.',
	);
	console.log(`  Browse:  ${storybookUrl.replace(/\/$/, '')}/?statuses=modified;new`);
	console.log(`  Browse:  ${reviewUrl}   (the agent's pushed review)`);
	console.log(`  Diff:    ${diffAbs} (${result?.agentChangedFiles.length ?? 0} files)`);
	console.log('');
	console.log(bold("When you're done inspecting, clean up manually:"));
	console.log(`  cd ${cwdAbs} && git checkout -- . && git clean -fd      # revert agent edits`);
	console.log(`  lsof -ti :${port} | xargs kill                          # kill storybook`);
} else {
	console.log(
		bold('Teardown: clean') +
			(result?.storybookKilled
				? ' — agent edits reverted, Storybook killed.'
				: ' — agent edits reverted.'),
	);
	if (record.pushedReviewState && (result?.agentChangedFiles.length ?? 0) > 0) {
		console.log('');
		console.log(bold('To browse the feature later') + ' (re-applies the agent diff):');
		console.log(`  pnpm replay-capture --scenario ${scenarioId}`);
		console.log(
			`  pnpm replay-capture --scenario ${scenarioId} --review     # also push a fresh review`,
		);
		console.log(`  pnpm replay-capture --scenario ${scenarioId} --revert     # when done`);
		console.log('');
		console.log('Or pass --keep-changes on the next capture run to skip the teardown entirely.');
	}
}

if (error) {
	console.log('');
	console.error(bold(red('Error:')));
	console.error(red(error));
	process.exitCode = 1;
}
