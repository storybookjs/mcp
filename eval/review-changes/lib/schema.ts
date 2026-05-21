/**
 * Review-eval schemas.
 *
 * The `ReviewStateSchema` mirrors the canonical one in
 * `packages/addon-mcp/src/review-state-store.ts`. We re-declare it here so
 * the eval has no build-time coupling to the addon's dist output, and we
 * pin it via a single round-trip schema test (see `schema.test.ts`).
 *
 * Anything that wants the runtime-validated shape — including the
 * `.payload.json` files this eval emits — validates against
 * `ReviewStateSchema`.
 */
import * as v from 'valibot';

export const CollectionKindSchema = v.picklist(['atomic', 'consumer', 'transitive', 'catch-all']);
export type CollectionKind = v.InferOutput<typeof CollectionKindSchema>;

export const ReviewCollectionSchema = v.object({
	title: v.string(),
	rationale: v.string(),
	sampleStoryIds: v.array(v.string()),
	kind: v.optional(CollectionKindSchema),
});

const StoryMetaSchema = v.object({
	depth: v.optional(v.number()),
	chain: v.optional(v.array(v.string())),
});

const DiffHunkSchema = v.object({
	path: v.string(),
	hunk: v.string(),
});

export const ReviewStateSchema = v.object({
	title: v.string(),
	description: v.string(),
	collections: v.array(ReviewCollectionSchema),
	changedFiles: v.optional(v.array(v.string())),
	diffHunks: v.optional(v.array(DiffHunkSchema)),
	storyMeta: v.optional(v.record(v.string(), StoryMetaSchema)),
});

export type ReviewCollection = v.InferOutput<typeof ReviewCollectionSchema>;
export type ReviewState = v.InferOutput<typeof ReviewStateSchema>;

/**
 * The status assigned by `get-changed-stories` to a story.
 */
export const ChangedStoryStatusSchema = v.picklist([
	'status-value:new',
	'status-value:modified',
	'status-value:affected',
]);
export type ChangedStoryStatus = v.InferOutput<typeof ChangedStoryStatusSchema>;

export const ChangedStorySchema = v.object({
	storyId: v.string(),
	statusValue: ChangedStoryStatusSchema,
	title: v.string(),
	name: v.string(),
	importPath: v.string(),
});
export type ChangedStory = v.InferOutput<typeof ChangedStorySchema>;

/**
 * Per-story depth in the dependency cascade from the changed file(s).
 * 0 = directly changed file, 1 = direct importer, etc.
 */
export const CascadeNodeSchema = v.object({
	storyId: v.string(),
	depth: v.number(),
	chain: v.optional(v.array(v.string())),
});
export type CascadeNode = v.InferOutput<typeof CascadeNodeSchema>;

export const StoryIndexEntrySchema = v.object({
	id: v.string(),
	title: v.string(),
	name: v.string(),
	importPath: v.string(),
	type: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
});

export const StoryIndexSchema = v.object({
	v: v.optional(v.number()),
	entries: v.record(v.string(), StoryIndexEntrySchema),
});
export type StoryIndex = v.InferOutput<typeof StoryIndexSchema>;

export const ReviewFixtureGroundTruthSchema = v.object({
	/**
	 * Optional: leave undefined for unlabelled fixtures. When absent, the
	 * surfacing grader returns `n/a` instead of zero. Empty array `[]` is
	 * a *positive* label meaning "nothing was important" (e.g. type-only
	 * changes) and is graded normally.
	 */
	importantStoryIds: v.optional(v.array(v.string())),
	expectedKinds: v.optional(v.record(v.string(), CollectionKindSchema)),
	notes: v.optional(v.string()),
});
export type ReviewFixtureGroundTruth = v.InferOutput<typeof ReviewFixtureGroundTruthSchema>;

/**
 * Where this fixture came from. Required so the meta-analysis agent can
 * `git -C <repoPath> show <baseCommit>:<file>` to inspect source at
 * record time.
 */
export const FixtureSourceSchema = v.object({
	/** Absolute path to the target repo on the machine that recorded this. */
	repoPath: v.string(),
	/** `git rev-parse HEAD` at record time. */
	baseCommit: v.string(),
	/**
	 * Lightweight git tag pinning `baseCommit` so it survives rebases,
	 * amends, and GC in the target repo. Written by `pnpm capture` as
	 * `eval-base/<scenario>/<ts>`. `replay-capture` resolves this first
	 * and falls back to the raw `baseCommit` SHA when absent.
	 */
	baseTag: v.optional(v.string()),
	/** True when the diff was captured from working-tree changes vs. HEAD. */
	workingTreeDirty: v.boolean(),
	storybookUrl: v.optional(v.string()),
});
export type FixtureSource = v.InferOutput<typeof FixtureSourceSchema>;

/**
 * A frozen recording of one UI change against a Storybook. The fixture is
 * the only input to a run — runners must not consult anything else.
 */
export const ReviewFixtureSchema = v.object({
	scenarioId: v.string(),
	recordedAt: v.string(),
	taskFraming: v.string(),
	diff: v.string(),
	changedFiles: v.array(v.string()),
	diffHunks: v.array(DiffHunkSchema),
	storyIndex: StoryIndexSchema,
	changedStories: v.array(ChangedStorySchema),
	cascade: v.optional(v.array(CascadeNodeSchema)),
	groundTruth: ReviewFixtureGroundTruthSchema,
	source: FixtureSourceSchema,
});
export type ReviewFixture = v.InferOutput<typeof ReviewFixtureSchema>;

/**
 * Run record: produced by the runner alongside the `.payload.json`. Contains
 * the full agent transcript plus scores. The payload-extractor re-derives
 * `.payload.json` from this if the run-record schema evolves.
 */
export const RunRecordSchema = v.object({
	/** Optional: present on replay runs, absent on E2E live-mcp captures. */
	fixtureRef: v.optional(v.string()),
	scenarioId: v.string(),
	/** The task prompt the agent received (E2E capture only). */
	task: v.optional(v.string()),
	/**
	 * The diff git observed after the agent ran, before the reset. Only
	 * present on live-mcp captures. Distinct from the agent's
	 * `pushedReviewState.diffHunks` (what the agent *says* it changed) —
	 * useful when the two disagree.
	 */
	agentDiff: v.optional(v.string()),
	agentChangedFiles: v.optional(v.array(v.string())),
	/**
	 * Snapshot of the target's Storybook environment at capture time, so
	 * the cascade-derived graders and a meta-analyst can judge whether the
	 * agent's clusters are *correct* — not just internally consistent —
	 * without re-opening the live repo. Populated by live-mcp captures
	 * after the agent runs (fetched from `<storybookUrl>/index.json` +
	 * `computeCascade`). Absent on SDK replay runs — the fixture carries
	 * the equivalent fields there.
	 */
	storyIndex: v.optional(StoryIndexSchema),
	changedStories: v.optional(v.array(ChangedStorySchema)),
	cascade: v.optional(v.array(CascadeNodeSchema)),
	/**
	 * Tool calls that came back with `is_error: true` during a live-mcp
	 * run. Paired by `tool_use_id` so the name is reliable. Surfaces
	 * silent failures (e.g. `get-changed-stories` returning 500) that
	 * would otherwise be buried hundreds of lines deep in the transcript.
	 */
	toolErrors: v.optional(
		v.array(
			v.object({
				name: v.string(),
				error: v.string(),
			}),
		),
	),
	/**
	 * Set when the runner restarted Storybook before this capture so the
	 * run started from a deterministic dev-server baseline. Captures the
	 * pid + spawn command + log path + wall-clock time of the restart.
	 */
	storybookRestart: v.optional(
		v.object({
			pid: v.optional(v.number()),
			spawnedCmd: v.string(),
			logPath: v.string(),
			totalMs: v.number(),
		}),
	),
	/** True when --keep-changes left the agent's edits + Storybook in place. */
	keptChanges: v.optional(v.boolean()),
	/** True when default teardown killed the spawned Storybook process. */
	storybookKilled: v.optional(v.boolean()),
	model: v.string(),
	agent: v.string(),
	driver: v.picklist(['sdk', 'ade-cli', 'baseline', 'live-mcp']),
	/**
	 * Coarse run outcome, so a meta-analyst can separate genuine agent
	 * misses from environment flakes without re-deriving it from `error`:
	 * - `ok`          — produced a schema-valid `pushedReviewState`.
	 * - `agent-error` — the agent ran but produced no / invalid payload.
	 * - `infra-error` — the harness/environment failed (Storybook restart,
	 *                   port contention, MCP preflight) — not the agent's fault.
	 * - `timeout`     — the wall-clock cap fired before the agent finished.
	 */
	status: v.optional(v.picklist(['ok', 'agent-error', 'infra-error', 'timeout'])),
	baseline: v.optional(v.string()),
	effort: v.optional(v.picklist(['low', 'medium', 'high'])),
	/** The full prompt sent to the model (LLM runs only). */
	prompt: v.optional(v.string()),
	/**
	 * Short identifier for the prompt used. Defaults to `sha-<first 8 of
	 * SHA-256 of the prompt text>` so prompt edits are auto-versioned;
	 * pass `--prompt-version <label>` to override with a human label.
	 */
	promptVersion: v.optional(v.string()),
	startedAt: v.string(),
	finishedAt: v.string(),
	latencyMs: v.number(),
	/**
	 * Token usage from the `result` message in Claude Code stream-json.
	 * `inputTokens` is only the *uncached* new input — with prompt caching
	 * (always on) the bulk of the real input is `cacheReadTokens` +
	 * `cacheCreationTokens`. Total input billed ≈ the sum of all three.
	 */
	inputTokens: v.optional(v.number()),
	outputTokens: v.optional(v.number()),
	cacheCreationTokens: v.optional(v.number()),
	cacheReadTokens: v.optional(v.number()),
	costUsd: v.optional(v.number()),
	/**
	 * Tool results that exceeded the Claude Code MCP output token cap and
	 * were spilled to a file on disk — the agent only saw a pointer and had
	 * to read the file back (usually partially). A silent quality risk: the
	 * agent operates on a truncated view of the tool's real output.
	 */
	fileSpills: v.optional(
		v.array(
			v.object({
				tool: v.string(),
				originalChars: v.number(),
				originalLines: v.optional(v.number()),
				spillPath: v.optional(v.string()),
			}),
		),
	),
	/**
	 * Per-tool roll-up of how much text each tool's results pushed back into
	 * the agent's context — the dominant token cost of a run. `resultChars`
	 * is exact; `resultTokensEst` is a chars/4 estimate. Sorted heaviest first.
	 */
	toolStats: v.optional(
		v.array(
			v.object({
				tool: v.string(),
				calls: v.number(),
				resultChars: v.number(),
				resultTokensEst: v.number(),
			}),
		),
	),
	pushedReviewState: v.optional(ReviewStateSchema),
	scores: v.record(v.string(), v.unknown()),
	/** Raw model output text (LLM runs only). */
	rawText: v.optional(v.string()),
	/**
	 * Full stream of events from the Claude Code subprocess (assistant
	 * messages, tool_use, tool_result, system, result). Opaque shape —
	 * preserved as written by the upstream CLI. Useful for meta-analysis
	 * agents that need to see what the agent under test actually did.
	 */
	transcript: v.optional(v.array(v.unknown())),
	/**
	 * Copied from `fixture.source` at run time so the meta-analyst can
	 * resolve the repo without re-opening the fixture.
	 */
	source: v.optional(FixtureSourceSchema),
	/** Free-form notes you can append later via `pnpm annotate`. */
	notes: v.optional(v.string()),
	error: v.optional(v.string()),
});
export type RunRecord = v.InferOutput<typeof RunRecordSchema>;
