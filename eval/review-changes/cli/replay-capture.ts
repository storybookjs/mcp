#!/usr/bin/env node
/**
 * CLI: take a past E2E capture and re-apply its agent diff into the
 * target repo, so you can open Storybook and see exactly what the
 * agent saw when it pushed `display-review`.
 *
 *   # Apply the latest capture for a scenario:
 *   pnpm replay-capture --scenario <slug>
 *
 *   # …and run the agent to push a fresh review to /review/:
 *   pnpm replay-capture --scenario <slug> --review
 *
 *   # Apply a specific run record:
 *   pnpm replay-capture --run review-changes/captures/<slug>/<ts>--<model>.json
 *
 *   # Revert (back to the branch you were on, drop the replay branch):
 *   pnpm replay-capture --scenario <slug> --revert
 *
 * `--review` is the optional second half: with the diff applied, it
 * spawns the agent against the target's live Storybook MCP to do the
 * *review* step only (no code edits) — that pushes `display-review`,
 * which lands on the `/review-changes/` page. Without `--review`, the
 * command only applies the diff and never touches the agent or MCP.
 *
 * How it replays — and why it no longer cares where your HEAD is:
 *
 * The old version refused unless the target's HEAD *equalled* the
 * captured `baseCommit`. That was wrong: the captured `agentDiff` is an
 * ordinary unified diff — `git apply` patches file *contents*, not a
 * commit position. Making a few unrelated commits in the target should
 * not block a replay.
 *
 * Instead, replay reproduces the exact state the agent reviewed:
 *  1. Resolve the capture's base — `source.baseTag` (a permanent git
 *     tag written at capture time) first, then the raw `source.baseCommit`.
 *  2. Check out a throwaway `review-replay/<scenario>` branch *at that
 *     base*, and apply the patch there. You get the agent's exact code
 *     state regardless of how far the target's main branch has moved,
 *     and a clean revert path (switch back, delete the branch).
 *  3. If the base commit is gone entirely (rebased/amended away and
 *     GC'd), fall back to `git apply --3way` onto the current HEAD with
 *     a loud warning that exact fidelity isn't guaranteed.
 *
 * Safety:
 * - Refuses to apply if the target working tree is dirty (unless
 *   `--force`) — switching branches would clobber your in-flight edits.
 * - `git apply --check` runs first; on failure it retries with
 *   `--3way` before giving up.
 * - A small `.replay-state.json` in the capture dir records the branch
 *   you were on so `--revert` can put you back exactly.
 */
import { program } from 'commander';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { x } from 'tinyexec';
import * as v from 'valibot';
import { RunRecordSchema, type RunRecord } from '../lib/schema.ts';
import { CAPTURES_DIR, resolveLatestCaptureRun } from '../lib/runs-index.ts';
import { formatPreflightFailure, preflightMcp } from '../lib/mcp-preflight.ts';
import { restartStorybook } from '../lib/storybook-lifecycle.ts';
import { runReviewAgent } from '../lib/review-agent.ts';
import { bold, green } from '../lib/term.ts';

program
	.option('--run <file>', 'path to a specific run record JSON to replay')
	.option('--scenario <slug>', `capture slug under ${CAPTURES_DIR}/; uses its most recent run`)
	.option(
		'--review',
		'after applying the diff, run the agent to push a fresh review to /review/',
	)
	.option('--model <id>', 'model for --review', 'claude-sonnet-4.6')
	.option('--revert', 'undo a replay: drop the patch, return to your branch')
	.option('--force', 'apply even if the target working tree is dirty');

program.parse();
const opts = program.opts<{
	run?: string;
	scenario?: string;
	review?: boolean;
	model: string;
	revert?: boolean;
	force?: boolean;
}>();

if (!opts.run && !opts.scenario) {
	console.error('Pass either --run <run-record.json> or --scenario <slug>.');
	process.exit(1);
}

let runFile: string;
if (opts.run) {
	runFile = path.resolve(opts.run);
} else {
	const latest = await resolveLatestCaptureRun(opts.scenario!);
	if (!latest) {
		console.error(`No capture runs found for scenario "${opts.scenario}" under ${CAPTURES_DIR}/.`);
		process.exit(1);
	}
	runFile = latest;
}
const captureDir = path.dirname(runFile);
const stateFile = path.join(captureDir, '.replay-state.json');

const raw = await fs.readFile(runFile, 'utf-8').catch((e) => {
	console.error(`Could not read run record at ${runFile}: ${(e as Error).message}`);
	process.exit(1);
});
const parsed = v.safeParse(RunRecordSchema, JSON.parse(raw));
if (!parsed.success) {
	console.error(`Not a valid run record: ${runFile}`);
	for (const issue of parsed.issues) {
		console.error(`  ${issue.path?.map((p) => p.key).join('.') ?? '<root>'}: ${issue.message}`);
	}
	process.exit(1);
}
const record: RunRecord = parsed.output;

if (!record.source?.repoPath) {
	console.error('Run record has no source.repoPath — cannot resolve target repo.');
	process.exit(1);
}
const repoPath = record.source.repoPath;
const storybookUrl = record.source.storybookUrl;

interface ReplayState {
	repoPath: string;
	/** Branch (or detached SHA) the user was on before the replay. */
	originalRef: string;
	/** The throwaway branch we created, or null if we applied onto HEAD. */
	replayBranch: string | null;
	runFile: string;
}

async function git(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const r = await x('git', ['-C', repoPath, ...args], {
		nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] },
	});
	return {
		exitCode: r.exitCode ?? 1,
		stdout: String(r.stdout ?? '').trim(),
		stderr: String(r.stderr ?? '').trim(),
	};
}

async function gitStatusPorcelain(): Promise<string> {
	return (await git(['status', '--porcelain'])).stdout;
}

/** Resolve a ref to a commit SHA, or undefined if it doesn't exist. */
async function resolveCommit(ref: string): Promise<string | undefined> {
	const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
	return r.exitCode === 0 && r.stdout ? r.stdout : undefined;
}

/** The branch the user is currently on, or the SHA if detached. */
async function currentRef(): Promise<string> {
	const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
	if (branch.exitCode === 0 && branch.stdout) return branch.stdout;
	return (await git(['rev-parse', 'HEAD'])).stdout;
}

async function readState(): Promise<ReplayState | undefined> {
	try {
		return JSON.parse(await fs.readFile(stateFile, 'utf-8')) as ReplayState;
	} catch {
		return undefined;
	}
}

/* --------------------------------- revert --------------------------------- */

if (opts.revert) {
	console.log(`Reverting replay`);
	console.log(`  target: ${repoPath}`);
	const state = await readState();

	// Drop the applied patch from the working tree either way.
	const dirty = await gitStatusPorcelain();
	if (dirty) {
		await git(['checkout', '--', '.']);
		await git(['clean', '-fd']);
	}

	if (state?.replayBranch) {
		const onReplay = (await currentRef()) === state.replayBranch;
		if (onReplay || (await resolveCommit(state.originalRef))) {
			const back = await git(['checkout', state.originalRef]);
			if (back.exitCode !== 0) {
				console.error(`  ! could not switch back to ${state.originalRef}:\n${back.stderr}`);
				console.error(`    you are still on ${state.replayBranch} — switch branches manually.`);
				process.exit(1);
			}
			console.log(`  ✓ back on ${state.originalRef}`);
		}
		const del = await git(['branch', '-D', state.replayBranch]);
		if (del.exitCode === 0) console.log(`  ✓ deleted ${state.replayBranch}`);
	}

	await fs.unlink(stateFile).catch(() => undefined);
	const after = await gitStatusPorcelain();
	if (after) {
		console.error(`  ! some dirty state remained after revert:\n${after}`);
		process.exit(1);
	}
	console.log('  ✓ clean');
	process.exit(0);
}

/* --------------------------------- apply ---------------------------------- */

const diff = record.agentDiff;
if (!diff || diff.trim().length === 0) {
	console.error(
		`Run record has no agentDiff — nothing to apply. (Was this a baseline or a no-edit run?)`,
	);
	process.exit(1);
}

console.log(bold('Replay capture'));
console.log(`  scenario:  ${record.scenarioId}`);
console.log(`  run:       ${path.basename(runFile)}`);
console.log(`  target:    ${repoPath}`);
console.log(`  diff:      ${record.agentChangedFiles?.length ?? 0} files`);
console.log('');

// --review needs a live Storybook MCP to talk to. Handle it before
// applying the diff so Storybook boots on the clean baseline — the
// applied patch then registers as a change for get-changed-stories.
let spawnedStorybookPid: number | undefined;
if (opts.review) {
	if (!storybookUrl) {
		console.error(
			'✗ --review needs the record to carry source.storybookUrl — this capture has none.',
		);
		process.exit(1);
	}
	let pf = await preflightMcp(storybookUrl);
	if (!pf.ok && pf.stage === 'unreachable') {
		// One-shot: no Storybook is running — start it ourselves rather
		// than make the user boot it by hand (the helper capture uses).
		console.log(`Starting Storybook at ${storybookUrl} …`);
		try {
			const sb = await restartStorybook({
				cwd: repoPath,
				storybookUrl,
				logPath: path.join(captureDir, 'replay-capture.storybook.log'),
			});
			spawnedStorybookPid = sb.pid;
			console.log(green(`  ✓ ready (pid ${sb.pid ?? '?'})`));
			console.log('');
		} catch (e) {
			console.error(`✗ Could not start Storybook: ${(e as Error).message}`);
			process.exit(1);
		}
		pf = await preflightMcp(storybookUrl);
	}
	if (!pf.ok) {
		console.error(formatPreflightFailure(pf));
		console.error('');
		console.error('--review needs a working Storybook MCP on the target.');
		process.exit(1);
	}
}

// An earlier replay that wasn't reverted would leave us on the replay
// branch and lose track of the real original branch — refuse rather
// than guess.
const existingState = await readState();
const replayBranch = `review-replay/${record.scenarioId}`;
const here = await currentRef();
if (here === replayBranch && !existingState) {
	console.error(`✗ You are on ${replayBranch} but there is no .replay-state.json.`);
	console.error(`  Run \`--revert\` or switch to your real branch before replaying again.`);
	process.exit(1);
}

// Resolve the base the capture was recorded against. Prefer the
// permanent tag; the raw SHA can be GC'd after a rebase/amend.
const baseRef =
	(record.source.baseTag && (await resolveCommit(record.source.baseTag))
		? record.source.baseTag
		: undefined) ??
	((await resolveCommit(record.source.baseCommit)) ? record.source.baseCommit : undefined);

const dirty = await gitStatusPorcelain();
if (dirty && !opts.force) {
	console.error(`✗ Target working tree is dirty. Refusing to apply (pass --force to override).`);
	console.error(`  ${dirty.split('\n').slice(0, 10).join('\n  ')}`);
	console.error(``);
	console.error(`Commit or stash your work in the target, then re-run.`);
	process.exit(1);
}

const tmp = path.join(os.tmpdir(), `replay-capture-${Date.now()}.patch`);
await fs.writeFile(tmp, diff);

async function applyPatch(): Promise<boolean> {
	const check = await git(['apply', '--check', tmp]);
	if (check.exitCode === 0) {
		const apply = await git(['apply', tmp]);
		return apply.exitCode === 0;
	}
	// Plain apply rejected — retry with a 3-way merge, which can resolve
	// context drift as long as the base blobs are reachable.
	console.log(`  (patch did not apply cleanly — retrying with --3way)`);
	const threeway = await git(['apply', '--3way', tmp]);
	if (threeway.exitCode === 0) return true;
	console.error(`✗ git apply failed (plain and --3way):`);
	console.error((threeway.stderr || check.stderr).replace(/^/gm, '    '));
	return false;
}

let usedBranch: string | null = null;
let originalRef = here;

if (baseRef) {
	originalRef = existingState?.originalRef ?? here;
	const co = await git(['checkout', '-B', replayBranch, baseRef]);
	if (co.exitCode !== 0) {
		console.error(`✗ Could not create the replay branch:\n${co.stderr.replace(/^/gm, '    ')}`);
		await fs.unlink(tmp).catch(() => undefined);
		process.exit(1);
	}
	usedBranch = replayBranch;
	if (!(await applyPatch())) {
		// Roll back the branch switch so the user is left where they started.
		await git(['checkout', '--', '.']);
		await git(['checkout', originalRef]);
		await git(['branch', '-D', replayBranch]);
		await fs.unlink(tmp).catch(() => undefined);
		process.exit(1);
	}
} else {
	console.log(`⚠ The capture's base commit (${record.source.baseCommit}) is no longer in the`);
	console.log(`  target repo — it was likely rebased, amended, or GC'd away. Applying onto the`);
	console.log(`  current HEAD instead; the surrounding code may differ from what the agent saw.`);
	console.log('');
	if (!(await applyPatch())) {
		await fs.unlink(tmp).catch(() => undefined);
		process.exit(1);
	}
}

await fs.unlink(tmp).catch(() => undefined);

const state: ReplayState = { repoPath, originalRef, replayBranch: usedBranch, runFile };
await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

console.log(
	green(
		usedBranch
			? `✓ Applied diff — on ${usedBranch} (was on ${originalRef})`
			: '✓ Applied diff — onto current HEAD',
	),
);
console.log('');
if (!spawnedStorybookPid && !opts.review) {
	const portFlag = storybookUrl ? ` --port ${new URL(storybookUrl).port || '6006'}` : '';
	console.log(`Start Storybook to browse the result:`);
	console.log(`  cd ${repoPath} && <pm> storybook${portFlag}`);
	console.log('');
}

// Without --review, show the stories the *original* capture surfaced.
// With --review, a fresh review supersedes them — don't print the stale set.
const collections = record.pushedReviewState?.collections ?? [];
if (!opts.review && collections.length > 0) {
	console.log(`Stories the agent surfaced (open these in your browser):`);
	for (const c of collections) {
		console.log(`  ${c.title}${c.kind ? ` (${c.kind})` : ''}:`);
		for (const id of c.storyIds) {
			if (storybookUrl) {
				console.log(`    ${storybookUrl.replace(/\/$/, '')}/?path=/story/${id}`);
			} else {
				console.log(`    ?path=/story/${id}`);
			}
		}
	}
	console.log('');
}

// --review: with the diff applied, run the agent to produce a *fresh*
// review and push it to the live /review/ page.
if (opts.review && storybookUrl) {
	console.log(`Running the review agent …`);
	const review = await runReviewAgent({
		cwd: repoPath,
		storybookUrl,
		model: opts.model,
	});
	console.log('');
	if (review.error) {
		console.error(`✗ Review agent failed: ${review.error}`);
	} else if (review.pushedReviewState) {
		const n = review.pushedReviewState.collections.length;
		const stories = review.pushedReviewState.collections.reduce(
			(s, c) => s + c.storyIds.length,
			0,
		);
		console.log(
			green(
				`✓ Review pushed — ${n} collection${n === 1 ? '' : 's'}, ${stories} stor${stories === 1 ? 'y' : 'ies'}` +
					`${review.costUsd != null ? ` ($${review.costUsd.toFixed(4)})` : ''}`,
			),
		);
		console.log(`  → ${storybookUrl.replace(/\/$/, '')}/?path=/review/`);
	} else {
		console.log(
			`⚠ The agent finished but never pushed display-review — the review page is unchanged.`,
		);
	}
	if (review.toolErrors.length > 0) {
		console.log(
			`  ⚠ ${review.toolErrors.length} tool error(s) during the run — collections may be degraded.`,
		);
	}
	console.log('');
}

if (spawnedStorybookPid) {
	const port = storybookUrl ? new URL(storybookUrl).port || '6006' : '6006';
	console.log(
		`Storybook left running (pid ${spawnedStorybookPid}) — stop: lsof -ti :${port} | xargs kill`,
	);
}
console.log(
	`Revert: pnpm replay-capture ${opts.run ? `--run ${runFile}` : `--scenario ${opts.scenario}`} --revert`,
);
