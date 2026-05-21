/**
 * Cross-scenario rollup of every recorded run.
 *
 * Walks `review-changes/tasks/<id>/.runs/*.json`, parses each as a
 * RunRecord, and emits one row per run into
 * `review-changes/.runs-index.json`. A meta-analysis agent reads this
 * one file to find every run it should inspect, with enough headline
 * data (scenario, model, promptVersion, scores, source) to decide
 * which run files to open.
 *
 * Why a flat file rather than a query API: an agent with `Read` is
 * happy with a single JSON read, and we want zero dependencies between
 * the runner and any future UI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import { REVIEW_TASKS_DIR, listScenarios, runsDir } from './paths.ts';
import { RunRecordSchema, type RunRecord } from './schema.ts';

export const RUNS_INDEX_FILE = path.join('review-changes', '.runs-index.json');
export const CAPTURES_DIR = path.join('review-changes', 'captures');

export interface RunsIndexRow {
	/** Relative path from the eval root to the run record JSON. */
	runFile: string;
	/** Relative path to the `.payload.json` if a valid payload was produced. */
	payloadFile?: string;
	scenarioId: string;
	model: string;
	driver: RunRecord['driver'];
	/** ok | agent-error | infra-error | timeout — see RunRecordSchema. */
	status?: RunRecord['status'];
	baseline?: string;
	effort?: RunRecord['effort'];
	promptVersion?: string;
	startedAt: string;
	latencyMs: number;
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
	costUsd?: number;
	hasNotes: boolean;
	hasTranscript: boolean;
	error?: string;
	/**
	 * Headline scores so an agent can rank runs without opening each
	 * file. Surfacing fields may be missing for unlabelled fixtures.
	 */
	scores: {
		schemaValid?: boolean;
		surfacingRecall?: number;
		surfacingPrecision?: number;
		surfacingF1?: number;
		kindCorrectness?: number;
		collectionPurity?: number;
		changedFilesAccuracy?: number;
		collectionCount?: number;
		pushedStoryCount?: number;
	};
	/**
	 * Copied from the run record's `source` (originally the fixture's
	 * source). Lets the meta-analyst `git -C repoPath show baseCommit:file`
	 * without re-opening the fixture.
	 */
	source?: {
		repoPath: string;
		baseCommit: string;
		workingTreeDirty: boolean;
		storybookUrl?: string;
	};
}

export interface RunsIndex {
	generatedAt: string;
	count: number;
	runs: RunsIndexRow[];
}

async function readRunRecord(file: string): Promise<RunRecord | undefined> {
	try {
		const raw = await fs.readFile(file, 'utf-8');
		const parsed = v.safeParse(RunRecordSchema, JSON.parse(raw));
		return parsed.success ? parsed.output : undefined;
	} catch {
		return undefined;
	}
}

function asNumber(x: unknown): number | undefined {
	return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

function asBool(x: unknown): boolean | undefined {
	return typeof x === 'boolean' ? x : undefined;
}

function toIndexRow(record: RunRecord, runFile: string): RunsIndexRow {
	const payloadFile = record.pushedReviewState ? runFile.replace(/\.json$/, '.payload.json') : undefined;
	const scores = record.scores ?? {};
	return {
		runFile,
		payloadFile,
		scenarioId: record.scenarioId,
		model: record.model,
		driver: record.driver,
		status: record.status,
		baseline: record.baseline,
		effort: record.effort,
		promptVersion: record.promptVersion,
		startedAt: record.startedAt,
		latencyMs: record.latencyMs,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		cacheCreationTokens: record.cacheCreationTokens,
		cacheReadTokens: record.cacheReadTokens,
		costUsd: record.costUsd,
		hasNotes: typeof record.notes === 'string' && record.notes.length > 0,
		hasTranscript: Array.isArray(record.transcript) && record.transcript.length > 0,
		error: record.error,
		scores: {
			schemaValid: asBool(scores.schemaValid),
			surfacingRecall: asNumber(scores.surfacingRecall),
			surfacingPrecision: asNumber(scores.surfacingPrecision),
			surfacingF1: asNumber(scores.surfacingF1),
			kindCorrectness: asNumber(scores.kindCorrectness),
			collectionPurity: asNumber(scores.collectionPurity),
			changedFilesAccuracy: asNumber(scores.changedFilesAccuracy),
			collectionCount: asNumber(scores.collectionCount),
			pushedStoryCount: asNumber(scores.pushedStoryCount),
		},
		source: record.source,
	};
}

async function collectRunsInDir(dir: string, rows: RunsIndexRow[]): Promise<void> {
	let entries: string[] = [];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue;
		if (entry.endsWith('.payload.json')) continue;
		if (entry.startsWith('latest')) continue;
		const full = path.join(dir, entry);
		const record = await readRunRecord(full);
		if (!record) continue;
		rows.push(toIndexRow(record, full));
	}
}

export async function rebuildRunsIndex(root = REVIEW_TASKS_DIR): Promise<RunsIndex> {
	const rows: RunsIndexRow[] = [];

	// Replay runs live under tasks/<id>/.runs/
	const scenarios = await listScenarios(root);
	for (const id of scenarios) {
		await collectRunsInDir(runsDir(id), rows);
	}

	// E2E captures live under captures/<id>/  (flat — no .runs subdir, because
	// every capture session is a fresh run; the dir IS the scenario).
	try {
		const captureEntries = await fs.readdir(CAPTURES_DIR, { withFileTypes: true });
		for (const e of captureEntries) {
			if (!e.isDirectory()) continue;
			await collectRunsInDir(path.join(CAPTURES_DIR, e.name), rows);
		}
	} catch {
		// captures/ may not exist yet — that's fine.
	}

	rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
	const index: RunsIndex = {
		generatedAt: new Date().toISOString(),
		count: rows.length,
		runs: rows,
	};
	await fs.writeFile(RUNS_INDEX_FILE, JSON.stringify(index, null, 2));
	return index;
}

/**
 * Resolve the most recent capture run record for a capture slug. Rebuilds
 * the index first so a freshly-written run is always visible, then picks
 * the row with the latest `startedAt` whose run file lives under
 * `captures/<slug>/`. Returns an absolute path, or undefined if the slug
 * has no recorded runs.
 *
 * This is the single source of truth for "the latest run" — there is no
 * `latest.json` copy to drift out of sync.
 */
export async function resolveLatestCaptureRun(slug: string): Promise<string | undefined> {
	const index = await rebuildRunsIndex();
	const prefix = path.join(CAPTURES_DIR, slug) + path.sep;
	const latest = index.runs
		.filter((r) => r.runFile.startsWith(prefix))
		.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
	return latest ? path.resolve(latest.runFile) : undefined;
}
