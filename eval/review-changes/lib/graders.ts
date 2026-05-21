/**
 * Pure graders for a review-eval run.
 *
 * Each grader is a function of `(pushedReviewState, fixture)` → a JSON-able
 * scalar / record. They never read disk or env, never call an LLM. The
 * runner composes them into the `scores` field of the run record.
 *
 * Score conventions
 * - Recall / precision / purity: 0..1, higher = better.
 * - kindCorrectness: 0..1 (fraction of collections whose `kind` matches the
 *   depth-derived expectation), or `undefined` when there is no cascade to
 *   grade against — distinct from 0 (= graded, every kind wrong).
 * - `schemaValid` / `diffHunksProvided`: boolean.
 * - `changedFilesAccuracy`: jaccard 0..1.
 */
import * as v from 'valibot';
import {
	ReviewStateSchema,
	type ReviewFixture,
	type ReviewState,
	type CollectionKind,
} from './schema.ts';

export type GraderName =
	| 'schemaValid'
	| 'surfacingRecall'
	| 'surfacingPrecision'
	| 'kindCorrectness'
	| 'collectionPurity'
	| 'changedFilesAccuracy'
	| 'diffHunksProvided'
	| 'descriptionLength';

export interface GraderScores {
	schemaValid: boolean;
	schemaErrors?: string[];
	/**
	 * Undefined when the fixture has no `groundTruth.importantStoryIds`
	 * (i.e. the fixture is unlabelled). Distinct from 0 (= surfaced
	 * nothing right) so the reporter can show `n/a` instead of failing.
	 */
	surfacingRecall?: number;
	surfacingPrecision?: number;
	surfacingF1?: number;
	/**
	 * Undefined when no collection could be graded — i.e. the fixture/capture
	 * carries no cascade, so there are no depth-derived expected kinds.
	 * Distinct from 0 (= graded, every collection's `kind` wrong) so the
	 * reporter shows `n/a` instead of a misleading 0%.
	 */
	kindCorrectness?: number;
	collectionPurity: number;
	changedFilesAccuracy: number;
	diffHunksProvided: boolean;
	descriptionLength: number;
	collectionCount: number;
	pushedStoryCount: number;
}

function intersection<T>(a: Iterable<T>, b: Set<T>): Set<T> {
	const out = new Set<T>();
	for (const x of a) if (b.has(x)) out.add(x);
	return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
	if (a.size === 0 && b.size === 0) return 1;
	const inter = intersection(a, b);
	const union = new Set<T>([...a, ...b]);
	return union.size === 0 ? 1 : inter.size / union.size;
}

export function gradeSchemaValid(
	pushed: unknown,
): { valid: boolean; errors: string[] } {
	const result = v.safeParse(ReviewStateSchema, pushed);
	if (result.success) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: result.issues.map((i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`),
	};
}

export function collectPushedStoryIds(pushed: ReviewState | undefined): string[] {
	if (!pushed) return [];
	return pushed.collections.flatMap((c) => c.sampleStoryIds);
}

export function gradeSurfacing(
	pushed: ReviewState | undefined,
	fixture: ReviewFixture,
): { recall: number; precision: number; f1: number } | undefined {
	// Undefined (vs empty array) = fixture not labelled yet → skip grading.
	if (fixture.groundTruth.importantStoryIds === undefined) return undefined;
	const important = new Set(fixture.groundTruth.importantStoryIds);
	const surfaced = new Set(collectPushedStoryIds(pushed));
	if (important.size === 0 && surfaced.size === 0) {
		return { recall: 1, precision: 1, f1: 1 };
	}
	const recall = important.size === 0 ? 1 : intersection(important, surfaced).size / important.size;
	const precision = surfaced.size === 0 ? 0 : intersection(surfaced, important).size / surfaced.size;
	const f1 = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
	return { recall, precision, f1 };
}

/**
 * Cascade depth → expected collection kind. Depth is component-hop
 * distance (re-export barrels cost 0 — see `compute-cascade.ts`), so:
 *   - depth 0 (the story file itself was changed) or 1 (the story of
 *     the directly-changed component) → `atomic`
 *   - depth 2 (a story whose component directly consumes the change) →
 *     `consumer`
 *   - depth ≥3 (pages / containers further down) → `transitive`
 * Overridable per story by `fixture.groundTruth.expectedKinds`.
 */
export function depthToKind(depth: number): CollectionKind {
	if (depth <= 1) return 'atomic';
	if (depth === 2) return 'consumer';
	return 'transitive';
}

function expectedKindForStory(storyId: string, fixture: ReviewFixture): CollectionKind | undefined {
	const override = fixture.groundTruth.expectedKinds?.[storyId];
	if (override) return override;
	const cascade = fixture.cascade?.find((n) => n.storyId === storyId);
	if (cascade) return depthToKind(cascade.depth);
	return undefined;
}

/**
 * Per-collection: the depth-derived expectation for a collection is the
 * *modal* expected kind across its members. `kindCorrectness` is the
 * fraction of collections whose assigned `kind` matches that mode.
 *
 * Returns `undefined` (not 0) when nothing could be graded — no pushed
 * review, or no collection had a single story with a depth-derived
 * expected kind (the fixture/capture carries no cascade). A 0 would read
 * as "the agent got every kind wrong"; `undefined` correctly reads as
 * "not graded — no ground truth".
 */
export function gradeKindCorrectness(
	pushed: ReviewState | undefined,
	fixture: ReviewFixture,
): number | undefined {
	if (!pushed || pushed.collections.length === 0) return undefined;
	let correct = 0;
	let scored = 0;
	for (const collection of pushed.collections) {
		if (!collection.kind) continue;
		const counts = new Map<CollectionKind, number>();
		for (const sid of collection.sampleStoryIds) {
			const k = expectedKindForStory(sid, fixture);
			if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		if (counts.size === 0) continue;
		scored += 1;
		const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
		if (mode === collection.kind) correct += 1;
	}
	return scored === 0 ? undefined : correct / scored;
}

/**
 * Per collection: fraction of members sharing the collection's
 * most-common expected kind. Averaged across collections (unweighted).
 */
export function gradeCollectionPurity(
	pushed: ReviewState | undefined,
	fixture: ReviewFixture,
): number {
	if (!pushed || pushed.collections.length === 0) return 0;
	let totalPurity = 0;
	let scored = 0;
	for (const collection of pushed.collections) {
		if (collection.sampleStoryIds.length === 0) continue;
		const counts = new Map<CollectionKind | '<unknown>', number>();
		for (const sid of collection.sampleStoryIds) {
			const k = expectedKindForStory(sid, fixture) ?? '<unknown>';
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		const max = Math.max(...counts.values());
		totalPurity += max / collection.sampleStoryIds.length;
		scored += 1;
	}
	return scored === 0 ? 0 : totalPurity / scored;
}

export function gradeChangedFilesAccuracy(
	pushed: ReviewState | undefined,
	fixture: ReviewFixture,
): number {
	const expected = new Set(fixture.changedFiles);
	const actual = new Set(pushed?.changedFiles ?? []);
	return jaccard(expected, actual);
}

export function gradeAll(
	pushed: ReviewState | undefined,
	fixture: ReviewFixture,
): GraderScores {
	const schema = gradeSchemaValid(pushed);
	const surfacing = gradeSurfacing(pushed, fixture);
	return {
		schemaValid: schema.valid,
		schemaErrors: schema.errors.length > 0 ? schema.errors : undefined,
		surfacingRecall: surfacing?.recall,
		surfacingPrecision: surfacing?.precision,
		surfacingF1: surfacing?.f1,
		kindCorrectness: gradeKindCorrectness(pushed, fixture),
		collectionPurity: gradeCollectionPurity(pushed, fixture),
		changedFilesAccuracy: gradeChangedFilesAccuracy(pushed, fixture),
		diffHunksProvided: (pushed?.diffHunks?.length ?? 0) > 0,
		descriptionLength: pushed?.description?.length ?? 0,
		collectionCount: pushed?.collections.length ?? 0,
		pushedStoryCount: collectPushedStoryIds(pushed).length,
	};
}

export type RunStatus = 'ok' | 'agent-error' | 'infra-error' | 'timeout';

/**
 * Classify a run's outcome so a meta-analyst can separate genuine agent
 * misses from environment flakes. `infra-error` covers harness failures
 * (Storybook restart, port contention, MCP preflight) that aren't the
 * agent's fault and should not drag down a measured pass rate.
 */
export function classifyRun(o: {
	error?: string;
	schemaValid: boolean;
	hasPushed: boolean;
}): RunStatus {
	const e = o.error ?? '';
	if (
		/storybook restart failed|did not free|did not become ready|preflight|mcp endpoint|not.*registered|pristine target|dependency reconcile|target repo is dirty/i.test(
			e,
		)
	) {
		return 'infra-error';
	}
	if (/exceeded \d+\s?ms|wall-clock cap|timed out|timeout/i.test(e)) return 'timeout';
	if (e) return 'agent-error';
	if (!o.hasPushed || !o.schemaValid) return 'agent-error';
	return 'ok';
}

/**
 * Aggregate the same grader across N runs of the same fixture+model. Used
 * for variance reporting.
 */
export function summariseRuns(scores: GraderScores[]): {
	count: number;
	mean: Partial<Record<keyof GraderScores, number>>;
	stdev: Partial<Record<keyof GraderScores, number>>;
} {
	const numericKeys: (keyof GraderScores)[] = [
		'surfacingRecall',
		'surfacingPrecision',
		'surfacingF1',
		'kindCorrectness',
		'collectionPurity',
		'changedFilesAccuracy',
		'descriptionLength',
		'collectionCount',
		'pushedStoryCount',
	];
	const mean: Partial<Record<keyof GraderScores, number>> = {};
	const stdev: Partial<Record<keyof GraderScores, number>> = {};
	for (const k of numericKeys) {
		const vals = scores
			.map((s) => s[k])
			.filter((x): x is number => typeof x === 'number');
		if (vals.length === 0) continue;
		const m = vals.reduce((a, b) => a + b, 0) / vals.length;
		const variance = vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length;
		mean[k] = m;
		stdev[k] = Math.sqrt(variance);
	}
	return { count: scores.length, mean, stdev };
}
