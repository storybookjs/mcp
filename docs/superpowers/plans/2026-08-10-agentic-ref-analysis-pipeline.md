# Agentic-ref Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm results:compare` — a reproducible pipeline that compares a control case against treatment cases over recorded agentic-ref run artifacts and produces OLS/HC3 estimates, BH-FDR verdicts, and annotated ECDF curves.

**Architecture:** A TypeScript front door (`scripts/compare-results.ts`) discovers runs, resolves cases/workflows, gates on data sufficiency (early-exiting with remediation commands), and emits a tidy `dataset.csv` + `manifest.json`; a uv-run single-file Python script (`scripts/compare_stats.py`, pinned by a committed lockfile) computes all statistics and figures. Spec: `docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md`.

**Tech Stack:** TypeScript run natively by Node (type stripping, no tsx), vitest + memfs for tests, pnpm scripts; Python via uv with PEP 723 inline deps (pandas, statsmodels, matplotlib).

## Global Constraints

- All TS runs directly via `node` (Node ≥24; local is v25.6.1). Imports use explicit `.ts` extensions. `agent-eval/package.json` has `"type": "module"` and subpath imports `#lib/*` → `./lib/*.ts`.
- Repo style: tabs for indentation in TS, single quotes, prettier-formatted. JSON emitted by the pipeline: 2-space indent, trailing `\n`, `\n` newlines only.
- Tests: vitest, colocated `lib/**/*.test.ts`. memfs pattern: `vi.mock('node:fs', ...)` (see Task 1 for the exact block). `scripts/` stays out of coverage (see `agent-eval/vitest.config.ts`) — logic that needs tests lives in `lib/`.
- Python: `uv` only (never pip/venv directly); PEP 723 inline metadata with `requires-python = ">=3.12"`; committed lockfile `scripts/compare_stats.py.lock`; always invoked `uv run --frozen`. uv is NOT installed on the dev machine until Task 8 runs.
- Statistics constants (from spec, do not vary): min-runs default **10**, FDR alpha **0.05**, method **fdr_bh**, covariance **HC3**, reference coding **`C(case, Treatment(reference=<control>))`**.
- Metrics version: always import `postAnalysis.metricsVersion` from `#lib/agentic-reference/post-analysis.ts` (currently 6) — never hardcode the number.
- Determinism: canonical ordering everywhere (cases: control first then treatments by case name; workflows by numeric id; batches by timestamp; runs by run number; metrics by registry order). Floats in CSV: JS `String(n)` / Python `repr(n)`. No wall-clock or randomness in any output except the manifest `provenance` block.
- All new pipeline code lives under `agent-eval/`. The results tree layout is `results/<experiment>/<timestamp>/<workflow>/run-N/` (a legacy extra `<model>` segment may appear between experiment and timestamp; `findRuns` already tolerates it).
- Working data note: all currently recorded runs have UNSTAMPED post-analysis caches, so until `pnpm results:analyze --recompute` is re-run, `results:compare` against real data correctly early-exits with "stale analysis" gaps. This is expected, not a bug.

## File Structure

| File | Responsibility |
|---|---|
| `agent-eval/lib/post-analysis/runs.ts` (new) | `Run` record + `findRuns` + `parseTimestamp` — shared run discovery (extracted from analyze-results.ts) |
| `agent-eval/lib/post-analysis/run-cache.ts` (new) | post-analysis-meta.json read/write + version validation (extracted + extended) |
| `agent-eval/scripts/analyze-results.ts` (modify) | use the two libs above; version-aware cache; re-emit analysis.json on cache hit |
| `agent-eval/lib/agentic-reference/cases.ts` (modify) | add `DEFAULT_CONTROL_CASE` |
| `agent-eval/lib/agentic-reference/comparison-metrics.ts` (new) | curated metric registry + dot-path extractor |
| `agent-eval/lib/agentic-reference/comparison/resolve.ts` (new) | case alias + workflow resolution, slug |
| `agent-eval/lib/agentic-reference/comparison/cells.ts` (new) | batch selection, usable-run classification, cell gating, auto workflow selection |
| `agent-eval/lib/agentic-reference/comparison/commands.ts` (new) | gap table + remediation command strings |
| `agent-eval/lib/agentic-reference/comparison/emit.ts` (new) | canonical dataset.csv + manifest.json |
| `agent-eval/lib/agentic-reference/comparison/options.ts` (new) | CLI arg parsing for results:compare |
| `agent-eval/lib/agentic-reference/comparison/uv.ts` (new) | locate the uv binary |
| `agent-eval/scripts/compare-results.ts` (new) | CLI orchestration: gate → emit → spawn python → stage-and-swap |
| `agent-eval/scripts/compare_stats.py` (new) | stats stage: OLS/HC3, BH-FDR, estimates, report.md, ECDF curves |
| `agent-eval/scripts/compare_stats.py.lock` (new, generated) | pinned Python deps |
| `agent-eval/scripts/setup-compare-stats.mts` (new) | install uv + prefetch env |
| `agent-eval/package.json`, `agent-eval/.gitignore` (modify) | `results:compare`, `results:compare:setup`, ignore `comparisons/` |
| `agent-eval/lib/agentic-reference/comparison/pipeline.integration.test.ts` (new) | end-to-end + determinism tests (skip without uv) |

---

### Task 1: Extract run discovery into `lib/post-analysis/runs.ts`

**Files:**
- Create: `agent-eval/lib/post-analysis/runs.ts`
- Test: `agent-eval/lib/post-analysis/runs.test.ts`
- Modify: `agent-eval/scripts/analyze-results.ts` (delete its local `Run`/`findRuns`/`parseTimestamp`, lines ~124–169, and import instead)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface Run { runDir: string; projectDir: string; experiment: string; model: string; timestamp: string; evalName: string; run: number }`, `export function findRuns(resultsDir: string): Run[]`, `export function parseTimestamp(value: string): number`.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/lib/post-analysis/runs.test.ts`:

```ts
import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findRuns, parseTimestamp } from './runs.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

const RESULTS = '/results';

afterEach(() => {
	vol.reset();
});

describe('findRuns', () => {
	it('parses the current agentic-ref layout (no model segment)', () => {
		vol.fromJSON({
			'/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1/project/x.txt':
				'',
			'/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-2/project/x.txt':
				'',
		});
		const runs = findRuns(RESULTS);
		expect(runs).toHaveLength(2);
		expect(runs[0]).toMatchObject({
			experiment: 'agentic-ref-cc-base-opus-high',
			model: '',
			timestamp: '2026-08-04T07-29-53.186Z',
			evalName: '703-fix-bug-flow',
			run: 1,
			runDir: '/results/agentic-ref-cc-base-opus-high/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1',
		});
	});

	it('parses the legacy layout with a model segment', () => {
		vol.fromJSON({
			'/results/agentic-ref-reuse/opus/2026-07-28T12-21-43.772Z/701-x/run-1/project/x.txt': '',
		});
		expect(findRuns(RESULTS)[0]).toMatchObject({ model: 'opus', evalName: '701-x' });
	});

	it('skips run-N dirs without a project/ child and non-run dirs', () => {
		vol.fromJSON({
			'/results/exp/2026-08-04T07-29-53.186Z/703-fix-bug-flow/run-1/result.json': '{}',
			'/results/exp/analysis-summary.json': '{}',
		});
		expect(findRuns(RESULTS)).toHaveLength(0);
	});

	it('returns [] for a missing directory', () => {
		expect(findRuns('/nope')).toEqual([]);
	});
});

describe('parseTimestamp', () => {
	it('parses the dashed on-disk form', () => {
		expect(parseTimestamp('2026-08-04T07-29-53.186Z')).toBe(
			Date.parse('2026-08-04T07:29:53.186Z'),
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/post-analysis/runs.test.ts`
Expected: FAIL — `Cannot find module './runs.ts'`.

- [ ] **Step 3: Create `agent-eval/lib/post-analysis/runs.ts`**

Move the code verbatim from `scripts/analyze-results.ts` (lines ~124–169), parameterizing `RESULTS_DIR`:

```ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Layout: results/<experiment>[/<model>]/<timestamp>/<eval>/run-N/project.
// The model segment only appears in legacy trees; current agentic-ref runs
// have none, so `model` is '' for them.
export interface Run {
	runDir: string;
	projectDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
}

export function findRuns(resultsDir: string): Run[] {
	if (!existsSync(resultsDir)) return [];
	const runs: Run[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(resultsDir.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0]!,
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3)!,
				evalName: parts.at(-2)!,
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(resultsDir);
	return runs;
}

/** On-disk timestamps replace the time's ':' with '-'; undo that for Date.parse. */
export function parseTimestamp(value: string): number {
	return Date.parse(value.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}
```

If the existing `parseTimestamp` in analyze-results.ts differs from the above, copy the existing implementation verbatim instead — behavior must not change.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/post-analysis/runs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Rewire `scripts/analyze-results.ts`**

Delete its local `interface Run`, `function findRuns`, and `function parseTimestamp`. Add to its imports:

```ts
import { findRuns, parseTimestamp, type Run } from '../lib/post-analysis/runs.ts';
```

Replace the call `findRuns(RESULTS_DIR)` — it now takes the directory explicitly (it already does at its one call site; just confirm the argument is `RESULTS_DIR`).

- [ ] **Step 6: Verify analyzer still typechecks and full tests pass**

Run: `pnpm --dir agent-eval run typecheck && pnpm --dir agent-eval run test:run`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-eval/lib/post-analysis/runs.ts agent-eval/lib/post-analysis/runs.test.ts agent-eval/scripts/analyze-results.ts
git commit -m "refactor: extract run discovery into lib/post-analysis/runs"
```

---

### Task 2: Version-aware analysis cache

**Files:**
- Create: `agent-eval/lib/post-analysis/run-cache.ts`
- Test: `agent-eval/lib/post-analysis/run-cache.test.ts`
- Modify: `agent-eval/scripts/analyze-results.ts` (replace local `CACHE_FILENAME`/`readCacheEntry`/`writeCacheEntry`, lines ~236–252, and the cache-hit branch, lines ~355–367)

**Interfaces:**
- Consumes: `readJson` from `agent-eval/lib/utils/files.ts` (returns null on missing/unparseable).
- Produces:
  - `export const CACHE_FILENAME = 'post-analysis-meta.json'`
  - `export interface CacheEntry { analyzedAt: string; metricsVersion?: number; output: Record<string, unknown> | null }`
  - `export function readCacheEntry(runDir: string): CacheEntry | null`
  - `export function isCurrentCacheEntry(entry: CacheEntry | null, metricsVersion: number | undefined): entry is CacheEntry` — true iff entry exists and `entry.metricsVersion === metricsVersion` (both-undefined matches, mirroring the baseline rule in `lib/post-analysis/baseline.ts`).
  - `export function writeCacheEntry(runDir: string, output: Record<string, unknown> | null, metricsVersion: number | undefined): void` — writes `{ analyzedAt, metricsVersion, output }` (omit `metricsVersion` key when undefined), 2-space JSON + `\n`.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/lib/post-analysis/run-cache.test.ts` (same memfs mock block as Task 1):

```ts
import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCurrentCacheEntry, readCacheEntry, writeCacheEntry } from './run-cache.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

afterEach(() => {
	vol.reset();
});

describe('run cache', () => {
	it('round-trips an entry with its metrics version', () => {
		vol.fromJSON({ '/run/x.txt': '' });
		writeCacheEntry('/run', { a: 1 }, 6);
		const entry = readCacheEntry('/run');
		expect(entry).toMatchObject({ metricsVersion: 6, output: { a: 1 } });
		expect(isCurrentCacheEntry(entry, 6)).toBe(true);
	});

	it('rejects a version mismatch and an unstamped legacy entry', () => {
		vol.fromJSON({
			'/run/post-analysis-meta.json': JSON.stringify({ analyzedAt: 'x', output: { a: 1 } }),
		});
		const entry = readCacheEntry('/run');
		expect(isCurrentCacheEntry(entry, 6)).toBe(false);
	});

	it('matches when both versions are undefined', () => {
		vol.fromJSON({ '/run/x.txt': '' });
		writeCacheEntry('/run', { a: 1 }, undefined);
		expect(isCurrentCacheEntry(readCacheEntry('/run'), undefined)).toBe(true);
	});

	it('returns null for a missing file', () => {
		expect(readCacheEntry('/nope')).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/post-analysis/run-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `agent-eval/lib/post-analysis/run-cache.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from '../utils/files.ts';

// One entry per run, stored next to the other artifacts; --recompute ignores it.
export const CACHE_FILENAME = 'post-analysis-meta.json';

export interface CacheEntry {
	analyzedAt: string;
	/** The metrics code version that produced `output`; absent on legacy entries. */
	metricsVersion?: number;
	output: Record<string, unknown> | null;
}

export function readCacheEntry(runDir: string): CacheEntry | null {
	return readJson(join(runDir, CACHE_FILENAME));
}

/** A cached analysis counts only when the current metrics code produced it. */
export function isCurrentCacheEntry(
	entry: CacheEntry | null,
	metricsVersion: number | undefined,
): entry is CacheEntry {
	return entry !== null && entry.metricsVersion === metricsVersion;
}

export function writeCacheEntry(
	runDir: string,
	output: Record<string, unknown> | null,
	metricsVersion: number | undefined,
) {
	console.log(`Writing ${CACHE_FILENAME} for ${runDir}`);
	const entry: CacheEntry = { analyzedAt: new Date().toISOString(), output };
	if (metricsVersion !== undefined) entry.metricsVersion = metricsVersion;
	writeFileSync(join(runDir, CACHE_FILENAME), JSON.stringify(entry, null, 2) + '\n');
}
```

Check `readJson`'s import path from `lib/post-analysis/` — analyze-results.ts imports it from `lib/utils/files.ts`; adjust the relative path (`../utils/files.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/post-analysis/run-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewire `scripts/analyze-results.ts`**

Delete its local cache section (`CACHE_FILENAME`, `readCacheEntry`, `writeCacheEntry`). Import:

```ts
import {
	isCurrentCacheEntry,
	readCacheEntry,
	writeCacheEntry,
} from '../lib/post-analysis/run-cache.ts';
```

Replace the cache-hit branch (currently `const cached = options.recompute ? null : readCacheEntry(run.runDir); if (cached) { ... }`) with:

```ts
		// Fetch cached post analysis output unless --recompute was passed. A stale
		// or unstamped entry (older metrics code) counts as a miss.
		const entry = options.recompute ? null : readCacheEntry(run.runDir);
		const cached = isCurrentCacheEntry(entry, postAnalysis.metricsVersion) ? entry : null;
		if (cached) {
			reused += 1;
			if (cached.output) {
				// Cache and artifact must not diverge: a hit re-emits a missing analysis.json.
				const analysisPath = join(run.runDir, 'analysis.json');
				if (!existsSync(analysisPath)) {
					writeFileSync(analysisPath, JSON.stringify(cached.output, null, 2) + '\n');
				}
				successfulAnalyses.push({
					...cached.output,
					__run: run,
					__postAnalysis: postAnalysis,
				});
			}
			continue;
		}
```

Update the fresh-analysis path's `writeCacheEntry(run.runDir, analysisOutput ?? null)` call to pass the version: `writeCacheEntry(run.runDir, analysisOutput ?? null, postAnalysis.metricsVersion)`.

- [ ] **Step 6: Typecheck + full test run**

Run: `pnpm --dir agent-eval run typecheck && pnpm --dir agent-eval run test:run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-eval/lib/post-analysis/run-cache.ts agent-eval/lib/post-analysis/run-cache.test.ts agent-eval/scripts/analyze-results.ts
git commit -m "feat: version-aware post-analysis cache that re-emits analysis.json on hits"
```

---

### Task 3: Metric registry + `DEFAULT_CONTROL_CASE`

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison-metrics.ts`
- Test: `agent-eval/lib/agentic-reference/comparison-metrics.test.ts`
- Modify: `agent-eval/lib/agentic-reference/cases.ts` (add one exported constant)

**Interfaces:**
- Produces:
  - In cases.ts: `export const DEFAULT_CONTROL_CASE = 'cc-control-none-opus-high';`
  - `export type MetricTransform = 'log' | 'log0' | 'none'`
  - `export type MetricDirection = 'lower-better' | 'higher-better' | 'neutral'`
  - `export interface ComparisonMetric { key: string; label: string; path: string; family: 'speed' | 'cost' | 'toolUse' | 'churn' | 'dsCoverage' | 'complexity' | 'diff'; transform: MetricTransform; direction: MetricDirection }`
  - `export const COMPARISON_METRICS: ComparisonMetric[]` (20 entries, spec order)
  - `export function metricValueAt(analysis: Record<string, unknown>, path: string): number | null` — walks the dot-path; returns the value only if it is a finite number, else null.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/lib/agentic-reference/comparison-metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { COMPARISON_METRICS, metricValueAt } from './comparison-metrics.ts';

describe('COMPARISON_METRICS', () => {
	it('has 20 unique keys and unique paths', () => {
		expect(COMPARISON_METRICS).toHaveLength(20);
		expect(new Set(COMPARISON_METRICS.map((m) => m.key)).size).toBe(20);
		expect(new Set(COMPARISON_METRICS.map((m) => m.path)).size).toBe(20);
	});

	it('only applies log to strictly-positive continuous metrics', () => {
		const logKeys = COMPARISON_METRICS.filter((m) => m.transform === 'log').map((m) => m.key);
		expect(logKeys.sort()).toEqual([
			'durationSeconds',
			'estimatedCostUsd',
			'inputTokens',
			'outputTokens',
		]);
		const log0Keys = COMPARISON_METRICS.filter((m) => m.transform === 'log0').map((m) => m.key);
		expect(log0Keys).toEqual(['slocAdded']);
	});
});

describe('metricValueAt', () => {
	const analysis = {
		speed: { durationSeconds: 227.4 },
		deltaToBaseline: { complexity: { cognitive: { delta: -2 } } },
		toolUse: null,
	};

	it('reads a nested numeric leaf', () => {
		expect(metricValueAt(analysis, 'speed.durationSeconds')).toBe(227.4);
		expect(metricValueAt(analysis, 'deltaToBaseline.complexity.cognitive.delta')).toBe(-2);
	});

	it('returns null for missing segments, null branches, and non-numbers', () => {
		expect(metricValueAt(analysis, 'speed.nope')).toBeNull();
		expect(metricValueAt(analysis, 'toolUse.buckets.docs')).toBeNull();
		expect(metricValueAt({ a: 'x' }, 'a')).toBeNull();
		expect(metricValueAt({ a: Number.NaN }, 'a')).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `agent-eval/lib/agentic-reference/comparison-metrics.ts`**

```ts
// The curated metric registry for results:compare. Only these enter the test
// grid; the spec fixes the list and each transform
// (docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md).
export type MetricTransform = 'log' | 'log0' | 'none';
export type MetricDirection = 'lower-better' | 'higher-better' | 'neutral';

export interface ComparisonMetric {
	/** Unique id; doubles as the dataset.csv column name. */
	key: string;
	label: string;
	/** Dot-path into a run's analysis.json. */
	path: string;
	family: 'speed' | 'cost' | 'toolUse' | 'churn' | 'dsCoverage' | 'complexity' | 'diff';
	/** log requires y > 0 (violations become reported missing values); log0 maps log(0) to 0. */
	transform: MetricTransform;
	direction: MetricDirection;
}

export const COMPARISON_METRICS: ComparisonMetric[] = [
	{ key: 'durationSeconds', label: 'Duration (s)', path: 'speed.durationSeconds', family: 'speed', transform: 'log', direction: 'lower-better' },
	{ key: 'turns', label: 'Turns', path: 'speed.turns', family: 'speed', transform: 'none', direction: 'lower-better' },
	{ key: 'estimatedCostUsd', label: 'Cost (USD)', path: 'cost.estimatedCostUsd', family: 'cost', transform: 'log', direction: 'lower-better' },
	{ key: 'inputTokens', label: 'Input tokens', path: 'cost.inputTokens', family: 'cost', transform: 'log', direction: 'lower-better' },
	{ key: 'outputTokens', label: 'Output tokens', path: 'cost.outputTokens', family: 'cost', transform: 'log', direction: 'lower-better' },
	{ key: 'cacheHitRate', label: 'Cache hit rate', path: 'cost.cacheHitRate', family: 'cost', transform: 'none', direction: 'higher-better' },
	{ key: 'totalToolCalls', label: 'Tool calls', path: 'cost.totalToolCalls', family: 'cost', transform: 'none', direction: 'lower-better' },
	{ key: 'docsCalls', label: 'Docs tool calls', path: 'toolUse.buckets.docs', family: 'toolUse', transform: 'none', direction: 'neutral' },
	{ key: 'explorationCalls', label: 'Exploration tool calls', path: 'toolUse.buckets.exploration', family: 'toolUse', transform: 'none', direction: 'neutral' },
	{ key: 'editCalls', label: 'Edit tool calls', path: 'toolUse.buckets.edit', family: 'toolUse', transform: 'none', direction: 'neutral' },
	{ key: 'verificationCalls', label: 'Verification tool calls', path: 'toolUse.buckets.verification', family: 'toolUse', transform: 'none', direction: 'neutral' },
	{ key: 'filesEdited', label: 'Files edited', path: 'churn.filesEdited', family: 'churn', transform: 'none', direction: 'lower-better' },
	{ key: 'dsShareOfAllNodes', label: 'DS share of all nodes', path: 'dsCoverage.dsShareOfAllNodes', family: 'dsCoverage', transform: 'none', direction: 'higher-better' },
	{ key: 'dsShareOfComponentNodes', label: 'DS share of component nodes', path: 'dsCoverage.dsShareOfComponentNodes', family: 'dsCoverage', transform: 'none', direction: 'higher-better' },
	{ key: 'cyclomaticDelta', label: 'Cyclomatic complexity Δ', path: 'deltaToBaseline.complexity.cyclomatic.delta', family: 'complexity', transform: 'none', direction: 'lower-better' },
	{ key: 'cognitiveDelta', label: 'Cognitive complexity Δ', path: 'deltaToBaseline.complexity.cognitive.delta', family: 'complexity', transform: 'none', direction: 'lower-better' },
	{ key: 'jsxCognitiveDelta', label: 'JSX cognitive complexity Δ', path: 'deltaToBaseline.complexity.jsxCognitive.delta', family: 'complexity', transform: 'none', direction: 'lower-better' },
	{ key: 'slocAdded', label: 'SLOC added', path: 'deltaToBaseline.diff.sloc.added', family: 'diff', transform: 'log0', direction: 'neutral' },
	{ key: 'slocNet', label: 'SLOC net', path: 'deltaToBaseline.diff.sloc.net', family: 'diff', transform: 'none', direction: 'neutral' },
	{ key: 'diffFilesChanged', label: 'Files changed vs baseline', path: 'deltaToBaseline.diff.filesChanged', family: 'diff', transform: 'none', direction: 'neutral' },
];

/** Numeric leaf at a dot-path, or null when absent, non-numeric, or non-finite. */
export function metricValueAt(analysis: Record<string, unknown>, path: string): number | null {
	let node: unknown = analysis;
	for (const segment of path.split('.')) {
		if (node === null || typeof node !== 'object') return null;
		node = (node as Record<string, unknown>)[segment];
	}
	return typeof node === 'number' && Number.isFinite(node) ? node : null;
}
```

- [ ] **Step 4: Add `DEFAULT_CONTROL_CASE` to `cases.ts`**

In `agent-eval/lib/agentic-reference/cases.ts`, directly below the `AGENTIC_REF_CASES` declaration:

```ts
/** The single control every comparison runs against unless --control overrides it. */
export const DEFAULT_CONTROL_CASE = 'cc-control-none-opus-high';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison-metrics.test.ts && pnpm --dir agent-eval run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison-metrics.ts agent-eval/lib/agentic-reference/comparison-metrics.test.ts agent-eval/lib/agentic-reference/cases.ts
git commit -m "feat: comparison metric registry and DEFAULT_CONTROL_CASE"
```

---

### Task 4: Case and workflow resolution

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/resolve.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/resolve.test.ts`

**Interfaces:**
- Consumes: `AGENTIC_REF_CASES`, `DEFAULT_CONTROL_CASE` from `../cases.ts`; `AGENT_NAME_PARTS` from `../experiment.ts`.
- Produces:
  - `export interface ResolvedCase { caseName: string; experiment: string; shortName: string }` — e.g. `{ caseName: 'cc-do-dont-opus-high', experiment: 'agentic-ref-cc-do-dont-opus-high', shortName: 'do-dont' }`.
  - `export function resolveCase(input: string): ResolvedCase` — accepts shortName, full case name, or experiment name; throws `Unknown case "<input>". Known cases: <sorted shortNames>` on miss; throws listing matches on ambiguity.
  - `export function resolveTreatments(input: string | undefined, control: ResolvedCase, experimentsWithData: string[]): ResolvedCase[]` — `undefined`/`'all'` → every non-control case whose experiment appears in `experimentsWithData`, sorted by caseName; else comma-split, each through `resolveCase`; throws if the control is listed.
  - `export function knownWorkflows(evalsDir: string): string[]` — sorted fixture dir names under evalsDir matching `/^7\d\d-/`.
  - `export function resolveWorkflows(input: string | undefined, known: string[]): string[] | null` — `undefined` → null (auto mode); `'all'` → known; else comma-split, each matched by exact name or unique numeric prefix; throws listing `known` on miss/ambiguity. Result sorted by numeric id.
  - `export function comparisonSlug(control: ResolvedCase, treatments: ResolvedCase[], workflows: string[]): string` — `<control.shortName>_vs_<shortNames sorted, '+'-joined>@<numeric ids sorted, '+'-joined>`.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/lib/agentic-reference/comparison/resolve.test.ts` (memfs mock block from Task 1 for `knownWorkflows`):

```ts
import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	comparisonSlug,
	knownWorkflows,
	resolveCase,
	resolveTreatments,
	resolveWorkflows,
} from './resolve.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

afterEach(() => {
	vol.reset();
});

describe('resolveCase', () => {
	it('resolves short, full, and experiment names to the same case', () => {
		const expected = {
			caseName: 'cc-do-dont-opus-high',
			experiment: 'agentic-ref-cc-do-dont-opus-high',
			shortName: 'do-dont',
		};
		expect(resolveCase('do-dont')).toEqual(expected);
		expect(resolveCase('cc-do-dont-opus-high')).toEqual(expected);
		expect(resolveCase('agentic-ref-cc-do-dont-opus-high')).toEqual(expected);
	});

	it('throws on unknown names, listing known short names', () => {
		expect(() => resolveCase('nope')).toThrow(/Unknown case "nope"/);
		expect(() => resolveCase('nope')).toThrow(/do-dont/);
	});
});

describe('resolveTreatments', () => {
	const control = resolveCase('control-none');

	it('expands all/undefined to non-control cases with data, sorted', () => {
		const withData = [
			'agentic-ref-cc-do-dont-opus-high',
			'agentic-ref-cc-full-opus-high',
			'agentic-ref-cc-control-none-opus-high',
		];
		const names = resolveTreatments(undefined, control, withData).map((c) => c.shortName);
		expect(names).toEqual(['do-dont', 'full']);
		expect(resolveTreatments('all', control, withData).map((c) => c.shortName)).toEqual(names);
	});

	it('rejects the control in the treatment list', () => {
		expect(() => resolveTreatments('control-none,full', control, [])).toThrow(/control/);
	});
});

describe('workflows', () => {
	it('lists 7xx fixture dirs', () => {
		vol.fromJSON({
			'/evals/701-new-ui-flow/PROMPT.md': '',
			'/evals/703-fix-bug-flow/PROMPT.md': '',
			'/evals/801-other/PROMPT.md': '',
		});
		expect(knownWorkflows('/evals')).toEqual(['701-new-ui-flow', '703-fix-bug-flow']);
	});

	it('resolves numeric prefixes and full names; null for auto mode', () => {
		const known = ['701-new-ui-flow', '703-fix-bug-flow'];
		expect(resolveWorkflows('703,701', known)).toEqual(['701-new-ui-flow', '703-fix-bug-flow']);
		expect(resolveWorkflows('701-new-ui-flow', known)).toEqual(['701-new-ui-flow']);
		expect(resolveWorkflows('all', known)).toEqual(known);
		expect(resolveWorkflows(undefined, known)).toBeNull();
		expect(() => resolveWorkflows('799', known)).toThrow(/701-new-ui-flow/);
	});
});

describe('comparisonSlug', () => {
	it('builds the deterministic slug', () => {
		const control = resolveCase('control-none');
		const treatments = [resolveCase('full'), resolveCase('do-dont')];
		expect(comparisonSlug(control, treatments, ['703-fix-bug-flow', '701-new-ui-flow'])).toBe(
			'control-none_vs_do-dont+full@701+703',
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolve.ts`**

```ts
import { readdirSync } from 'node:fs';

import { AGENTIC_REF_CASES } from '../cases.ts';
import { AGENT_NAME_PARTS } from '../experiment.ts';

export interface ResolvedCase {
	caseName: string;
	experiment: string;
	shortName: string;
}

const EXPERIMENT_PREFIX = 'agentic-ref-';

/** cc-do-dont-opus-high -> do-dont, by stripping any agent's prefix/suffix pair. */
function shortNameOf(caseName: string): string {
	for (const { prefix, modelSuffix } of Object.values(AGENT_NAME_PARTS)) {
		const head = `${prefix}-`;
		const tail = `-${modelSuffix}`;
		if (caseName.startsWith(head) && caseName.endsWith(tail)) {
			return caseName.slice(head.length, -tail.length);
		}
	}
	return caseName;
}

function resolvedCases(): ResolvedCase[] {
	return AGENTIC_REF_CASES.map((c) => ({
		caseName: c.name,
		experiment: `${EXPERIMENT_PREFIX}${c.name}`,
		shortName: shortNameOf(c.name),
	}));
}

export function resolveCase(input: string): ResolvedCase {
	const matches = resolvedCases().filter(
		(c) => c.shortName === input || c.caseName === input || c.experiment === input,
	);
	if (matches.length === 1) return matches[0]!;
	const known = resolvedCases()
		.map((c) => c.shortName)
		.sort()
		.join(', ');
	if (matches.length === 0) throw new Error(`Unknown case "${input}". Known cases: ${known}`);
	throw new Error(
		`Ambiguous case "${input}": matches ${matches.map((c) => c.caseName).join(', ')}`,
	);
}

export function resolveTreatments(
	input: string | undefined,
	control: ResolvedCase,
	experimentsWithData: string[],
): ResolvedCase[] {
	if (input === undefined || input === 'all') {
		return resolvedCases()
			.filter((c) => c.caseName !== control.caseName)
			.filter((c) => experimentsWithData.includes(c.experiment))
			.sort((a, b) => a.caseName.localeCompare(b.caseName));
	}
	const treatments = input.split(',').map((name) => resolveCase(name.trim()));
	if (treatments.some((c) => c.caseName === control.caseName)) {
		throw new Error(`The control case "${control.shortName}" cannot also be a treatment.`);
	}
	return treatments;
}

export function knownWorkflows(evalsDir: string): string[] {
	return readdirSync(evalsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && /^7\d\d-/.test(entry.name))
		.map((entry) => entry.name)
		.sort();
}

export function resolveWorkflows(input: string | undefined, known: string[]): string[] | null {
	if (input === undefined) return null;
	if (input === 'all') return [...known];
	const resolved = input.split(',').map((raw) => {
		const name = raw.trim();
		const matches = known.filter((w) => w === name || w.startsWith(`${name}-`));
		if (matches.length === 1) return matches[0]!;
		throw new Error(
			matches.length === 0
				? `Unknown workflow "${name}". Known workflows: ${known.join(', ')}`
				: `Ambiguous workflow "${name}": matches ${matches.join(', ')}`,
		);
	});
	return [...new Set(resolved)].sort();
}

/** Deterministic output-directory slug for a comparison. */
export function comparisonSlug(
	control: ResolvedCase,
	treatments: ResolvedCase[],
	workflows: string[],
): string {
	const t = treatments
		.map((c) => c.shortName)
		.sort()
		.join('+');
	const w = workflows
		.map((name) => name.split('-')[0]!)
		.sort()
		.join('+');
	return `${control.shortName}_vs_${t}@${w}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/resolve.ts agent-eval/lib/agentic-reference/comparison/resolve.test.ts
git commit -m "feat: case and workflow resolution for results:compare"
```

---

### Task 5: Cells — batch selection, usable-run classification, gating

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/cells.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/cells.test.ts`

**Interfaces:**
- Consumes: `Run`, `parseTimestamp` from `../../post-analysis/runs.ts`; `readCacheEntry`, `isCurrentCacheEntry` from `../../post-analysis/run-cache.ts`; `readJson` from `../../utils/files.ts`; `ResolvedCase` from `./resolve.ts`.
- Produces:
  - `export type ExclusionReason = 'infra-failure' | 'malformed-analysis'`
  - `export type GapReason = 'missing-runs' | 'unanalyzed' | 'stale-analysis'`
  - `export interface ExcludedRun { runDir: string; reason: ExclusionReason }`
  - `export interface UsableRun { run: Run; analysis: Record<string, unknown> }`
  - `export interface Cell { case: ResolvedCase; workflow: string; batch: string; runs: UsableRun[]; excluded: ExcludedRun[]; unanalyzed: number; stale: number; passed: number; failed: number }` — `batch` is the selected timestamp, or `'all'` with `allBatches`; `passed`/`failed` count `result.json.status` across ALL selected runs (context for the report; classify() reads each run's result.json unconditionally to tally them).
  - `export interface CellGap { case: ResolvedCase; workflow: string; have: number; need: number; reason: GapReason }`
  - `export function buildCells(options: { runs: Run[]; cases: ResolvedCase[]; workflows: string[]; minRuns: number; allBatches: boolean; metricsVersion: number | undefined }): { cells: Cell[]; gaps: CellGap[] }`
  - `export function autoSelectWorkflows(options: { runs: Run[]; cases: ResolvedCase[]; candidates: string[]; minRuns: number; allBatches: boolean; metricsVersion: number | undefined }): { selected: string[]; skipped: { workflow: string; gaps: CellGap[] }[] }` — strict intersection: a candidate is selected iff `buildCells` for that single workflow yields zero gaps.

Classification rule per discovered run, in priority order:
1. `analysis.json` missing + `result.json.status === 'failed'` → excluded `infra-failure`.
2. `analysis.json` missing otherwise → counts toward the cell's `unanalyzed`; produces an `unanalyzed` gap.
3. `analysis.json` unparseable (readJson → null but file exists) → excluded `malformed-analysis`.
4. Cache entry missing or `!isCurrentCacheEntry(entry, metricsVersion)` → counts toward `stale`; produces a `stale-analysis` gap.
5. Otherwise usable.

A cell short of `minRuns` usable runs gets exactly one gap: `stale-analysis` if stale runs alone would close the shortfall, else `unanalyzed` if unanalyzed runs would, else `missing-runs` with `need = minRuns` and `have = usable`. Batch selection happens before classification: with `allBatches: false`, only runs in the newest timestamp (by `parseTimestamp`) per (case, workflow) among discovered runs are considered.

- [ ] **Step 1: Write the failing test**

Create `agent-eval/lib/agentic-reference/comparison/cells.test.ts`. Helper builds a memfs tree; `mkRun` writes `project/`, `result.json`, and optionally `analysis.json` + a stamped cache:

```ts
import { vol } from 'memfs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findRuns } from '../../post-analysis/runs.ts';
import type { ResolvedCase } from './resolve.ts';
import { autoSelectWorkflows, buildCells } from './cells.ts';

vi.mock('node:fs', async () => {
	const memfs = await vi.importActual<typeof import('memfs')>('memfs');
	return { ...memfs.fs, default: memfs.fs };
});

const RESULTS = '/results';
const CONTROL: ResolvedCase = {
	caseName: 'cc-control-none-opus-high',
	experiment: 'agentic-ref-cc-control-none-opus-high',
	shortName: 'control-none',
};
const TREATMENT: ResolvedCase = {
	caseName: 'cc-do-dont-opus-high',
	experiment: 'agentic-ref-cc-do-dont-opus-high',
	shortName: 'do-dont',
};
const WF = '703-fix-bug-flow';
const TS1 = '2026-08-01T00-00-00.000Z';
const TS2 = '2026-08-05T00-00-00.000Z';

function mkRun(
	experiment: string,
	timestamp: string,
	run: number,
	state: 'usable' | 'infra' | 'unanalyzed' | 'stale' | 'malformed',
) {
	const dir = `${RESULTS}/${experiment}/${timestamp}/${WF}/run-${run}`;
	vol.fromJSON({ [`${dir}/project/x.txt`]: '' });
	if (state === 'infra') {
		vol.fromJSON({ [`${dir}/result.json`]: JSON.stringify({ status: 'failed' }) });
		return;
	}
	vol.fromJSON({ [`${dir}/result.json`]: JSON.stringify({ status: 'passed' }) });
	if (state === 'unanalyzed') return;
	if (state === 'malformed') {
		vol.fromJSON({ [`${dir}/analysis.json`]: '{not json' });
		return;
	}
	vol.fromJSON({
		[`${dir}/analysis.json`]: JSON.stringify({ speed: { durationSeconds: 100 + run } }),
		[`${dir}/post-analysis-meta.json`]: JSON.stringify({
			analyzedAt: 'x',
			...(state === 'stale' ? {} : { metricsVersion: 6 }),
			output: {},
		}),
	});
}

afterEach(() => {
	vol.reset();
});

function build(overrides: Partial<Parameters<typeof buildCells>[0]> = {}) {
	return buildCells({
		runs: findRuns(RESULTS),
		cases: [CONTROL, TREATMENT],
		workflows: [WF],
		minRuns: 2,
		allBatches: false,
		metricsVersion: 6,
		...overrides,
	});
}

describe('buildCells', () => {
	it('accepts a complete comparison and picks the latest batch', () => {
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS1, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([]);
		expect(cells).toHaveLength(2);
		expect(cells.every((c) => c.batch === TS2)).toBe(true);
		expect(cells[0]!.runs).toHaveLength(2);
	});

	it('pools batches with allBatches', () => {
		mkRun(CONTROL.experiment, TS1, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build({ allBatches: true });
		expect(gaps).toEqual([]);
		expect(cells.find((c) => c.case === CONTROL)!.runs).toHaveLength(2);
		expect(cells.find((c) => c.case === CONTROL)!.batch).toBe('all');
	});

	it('excludes infra failures and reports missing-runs gaps with commands data', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'infra');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'missing-runs' },
		]);
		expect(cells.find((c) => c.case === CONTROL)!.excluded).toEqual([
			{ runDir: `${RESULTS}/${CONTROL.experiment}/${TS2}/${WF}/run-2`, reason: 'infra-failure' },
		]);
	});

	it('classifies unanalyzed and stale shortfalls distinctly', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'unanalyzed');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'stale');
		const { gaps } = build();
		expect(gaps).toEqual([
			{ case: CONTROL, workflow: WF, have: 1, need: 2, reason: 'unanalyzed' },
			{ case: TREATMENT, workflow: WF, have: 1, need: 2, reason: 'stale-analysis' },
		]);
	});

	it('treats malformed analysis.json as excluded, not usable', () => {
		mkRun(CONTROL.experiment, TS2, 1, 'usable');
		mkRun(CONTROL.experiment, TS2, 2, 'malformed');
		mkRun(TREATMENT.experiment, TS2, 1, 'usable');
		mkRun(TREATMENT.experiment, TS2, 2, 'usable');
		const { cells, gaps } = build();
		expect(gaps[0]).toMatchObject({ reason: 'missing-runs', have: 1 });
		expect(cells.find((c) => c.case === CONTROL)!.excluded[0]).toMatchObject({
			reason: 'malformed-analysis',
		});
	});
});

describe('autoSelectWorkflows', () => {
	it('selects only workflows where every case passes the gate', () => {
		for (let i = 1; i <= 2; i++) mkRun(CONTROL.experiment, TS2, i, 'usable');
		for (let i = 1; i <= 2; i++) mkRun(TREATMENT.experiment, TS2, i, 'usable');
		const { selected, skipped } = autoSelectWorkflows({
			runs: findRuns(RESULTS),
			cases: [CONTROL, TREATMENT],
			candidates: [WF, '701-new-ui-flow'],
			minRuns: 2,
			allBatches: false,
			metricsVersion: 6,
		});
		expect(selected).toEqual([WF]);
		expect(skipped).toHaveLength(1);
		expect(skipped[0]!.workflow).toBe('701-new-ui-flow');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/cells.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cells.ts`**

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseTimestamp, type Run } from '../../post-analysis/runs.ts';
import { isCurrentCacheEntry, readCacheEntry } from '../../post-analysis/run-cache.ts';
import { readJson } from '../../utils/files.ts';
import type { ResolvedCase } from './resolve.ts';

export type ExclusionReason = 'infra-failure' | 'malformed-analysis';
export type GapReason = 'missing-runs' | 'unanalyzed' | 'stale-analysis';

export interface ExcludedRun {
	runDir: string;
	reason: ExclusionReason;
}

export interface UsableRun {
	run: Run;
	analysis: Record<string, unknown>;
}

export interface Cell {
	case: ResolvedCase;
	workflow: string;
	/** Selected timestamp, or 'all' when pooling batches. */
	batch: string;
	runs: UsableRun[];
	excluded: ExcludedRun[];
	unanalyzed: number;
	stale: number;
}

export interface CellGap {
	case: ResolvedCase;
	workflow: string;
	have: number;
	need: number;
	reason: GapReason;
}

interface BuildOptions {
	runs: Run[];
	cases: ResolvedCase[];
	workflows: string[];
	minRuns: number;
	allBatches: boolean;
	metricsVersion: number | undefined;
}

function classify(run: Run, metricsVersion: number | undefined, cell: Cell) {
	const result = readJson<{ status?: string }>(join(run.runDir, 'result.json'));
	if (result?.status === 'passed') cell.passed += 1;
	else if (result?.status === 'failed') cell.failed += 1;
	const analysisPath = join(run.runDir, 'analysis.json');
	if (!existsSync(analysisPath)) {
		if (result?.status === 'failed') {
			cell.excluded.push({ runDir: run.runDir, reason: 'infra-failure' });
		} else {
			cell.unanalyzed += 1;
		}
		return;
	}
	const analysis = readJson<Record<string, unknown>>(analysisPath);
	if (analysis === null) {
		cell.excluded.push({ runDir: run.runDir, reason: 'malformed-analysis' });
		return;
	}
	if (!isCurrentCacheEntry(readCacheEntry(run.runDir), metricsVersion)) {
		cell.stale += 1;
		return;
	}
	cell.runs.push({ run, analysis });
}

export function buildCells(options: BuildOptions): { cells: Cell[]; gaps: CellGap[] } {
	const cells: Cell[] = [];
	const gaps: CellGap[] = [];
	for (const resolvedCase of options.cases) {
		for (const workflow of options.workflows) {
			const candidates = options.runs.filter(
				(run) => run.experiment === resolvedCase.experiment && run.evalName === workflow,
			);
			const batches = [...new Set(candidates.map((run) => run.timestamp))].sort(
				(a, b) => parseTimestamp(a) - parseTimestamp(b),
			);
			const batch = options.allBatches ? 'all' : (batches.at(-1) ?? 'none');
			const selected = options.allBatches
				? candidates
				: candidates.filter((run) => run.timestamp === batch);
			const cell: Cell = {
				case: resolvedCase,
				workflow,
				batch,
				runs: [],
				excluded: [],
				unanalyzed: 0,
				stale: 0,
				passed: 0,
				failed: 0,
			};
			for (const run of selected.sort((a, b) => a.run - b.run)) {
				classify(run, options.metricsVersion, cell);
			}
			cells.push(cell);
			if (cell.runs.length < options.minRuns) {
				const shortfall = options.minRuns - cell.runs.length;
				const reason: GapReason =
					cell.stale >= shortfall
						? 'stale-analysis'
						: cell.unanalyzed >= shortfall
							? 'unanalyzed'
							: 'missing-runs';
				gaps.push({
					case: resolvedCase,
					workflow,
					have: cell.runs.length,
					need: options.minRuns,
					reason,
				});
			}
		}
	}
	return { cells, gaps };
}

/** Strict intersection: keep candidates where every case meets the gate. */
export function autoSelectWorkflows(options: Omit<BuildOptions, 'workflows'> & { candidates: string[] }) {
	const selected: string[] = [];
	const skipped: { workflow: string; gaps: CellGap[] }[] = [];
	for (const workflow of options.candidates) {
		const { gaps } = buildCells({ ...options, workflows: [workflow] });
		if (gaps.length === 0) selected.push(workflow);
		else skipped.push({ workflow, gaps });
	}
	return { selected, skipped };
}
```

Check `readJson`'s actual signature in `lib/utils/files.ts` — if it is untyped (`(path: string) => unknown`), adapt the call sites with the narrowing the file's existing consumers use.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/cells.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/cells.ts agent-eval/lib/agentic-reference/comparison/cells.test.ts
git commit -m "feat: cell construction, usable-run classification, and gating"
```

---

### Task 6: Gap table and remediation commands

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/commands.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/commands.test.ts`

**Interfaces:**
- Consumes: `CellGap` from `./cells.ts`.
- Produces:
  - `export function formatGapTable(gaps: CellGap[]): string` — one line per gap: `<shortName>  <workflow>  <have>/<need>  <reason>`, aligned with two spaces, preceded by a header line `case  workflow  runs  reason`.
  - `export function remediationCommands(gaps: CellGap[]): string[]` — deduplicated, sorted:
    - `missing-runs` gaps grouped by experiment: `AGENTIC_REF_FLOW=<workflows comma-joined sorted> AGENTIC_REF_RUNS=<max need> pnpm eval:agentic-ref <experiment>`
    - `unanalyzed` gaps grouped by experiment: `pnpm results:analyze --experiment=<experiment>`
    - `stale-analysis` gaps grouped by experiment: `pnpm results:analyze --recompute --experiment=<experiment>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import type { ResolvedCase } from './resolve.ts';
import { formatGapTable, remediationCommands } from './commands.ts';

const DO_DONT: ResolvedCase = {
	caseName: 'cc-do-dont-opus-high',
	experiment: 'agentic-ref-cc-do-dont-opus-high',
	shortName: 'do-dont',
};
const FULL: ResolvedCase = {
	caseName: 'cc-full-opus-high',
	experiment: 'agentic-ref-cc-full-opus-high',
	shortName: 'full',
};

describe('remediationCommands', () => {
	it('groups collection gaps per experiment with workflows comma-joined', () => {
		expect(
			remediationCommands([
				{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
				{ case: DO_DONT, workflow: '701-new-ui-flow', have: 3, need: 10, reason: 'missing-runs' },
				{ case: FULL, workflow: '701-new-ui-flow', have: 2, need: 10, reason: 'stale-analysis' },
			]),
		).toEqual([
			'AGENTIC_REF_FLOW=701-new-ui-flow,703-fix-bug-flow AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high',
			'pnpm results:analyze --recompute --experiment=agentic-ref-cc-full-opus-high',
		]);
	});

	it('emits a plain analyze command for unanalyzed gaps', () => {
		expect(
			remediationCommands([
				{ case: FULL, workflow: '703-fix-bug-flow', have: 4, need: 10, reason: 'unanalyzed' },
			]),
		).toEqual(['pnpm results:analyze --experiment=agentic-ref-cc-full-opus-high']);
	});
});

describe('formatGapTable', () => {
	it('renders one aligned line per gap', () => {
		const table = formatGapTable([
			{ case: DO_DONT, workflow: '703-fix-bug-flow', have: 0, need: 10, reason: 'missing-runs' },
		]);
		expect(table).toContain('case');
		expect(table).toContain('do-dont');
		expect(table).toContain('0/10');
		expect(table).toContain('missing-runs');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/commands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `commands.ts`**

```ts
import type { CellGap } from './cells.ts';

export function formatGapTable(gaps: CellGap[]): string {
	const rows = [
		['case', 'workflow', 'runs', 'reason'],
		...gaps.map((gap) => [
			gap.case.shortName,
			gap.workflow,
			`${gap.have}/${gap.need}`,
			gap.reason,
		]),
	];
	const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
	return rows
		.map((row) => row.map((value, col) => value.padEnd(widths[col]!)).join('  ').trimEnd())
		.join('\n');
}

export function remediationCommands(gaps: CellGap[]): string[] {
	const collect = new Map<string, { workflows: Set<string>; need: number }>();
	const analyze = new Set<string>();
	const recompute = new Set<string>();
	for (const gap of gaps) {
		const experiment = gap.case.experiment;
		if (gap.reason === 'missing-runs') {
			const entry = collect.get(experiment) ?? { workflows: new Set(), need: 0 };
			entry.workflows.add(gap.workflow);
			entry.need = Math.max(entry.need, gap.need);
			collect.set(experiment, entry);
		} else if (gap.reason === 'unanalyzed') {
			analyze.add(experiment);
		} else {
			recompute.add(experiment);
		}
	}
	return [
		...[...collect.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(
				([experiment, { workflows, need }]) =>
					`AGENTIC_REF_FLOW=${[...workflows].sort().join(',')} AGENTIC_REF_RUNS=${need} pnpm eval:agentic-ref ${experiment}`,
			),
		...[...analyze].sort().map((e) => `pnpm results:analyze --experiment=${e}`),
		...[...recompute].sort().map((e) => `pnpm results:analyze --recompute --experiment=${e}`),
	];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/commands.ts agent-eval/lib/agentic-reference/comparison/commands.test.ts
git commit -m "feat: gap table and remediation command generation"
```

---

### Task 7: Canonical dataset.csv and manifest.json emission

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/emit.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/emit.test.ts`

**Interfaces:**
- Consumes: `Cell`, `UsableRun` from `./cells.ts`; `ResolvedCase` from `./resolve.ts`; `ComparisonMetric`, `metricValueAt` from `../comparison-metrics.ts`.
- Produces:
  - `export interface ComparisonSpec { control: ResolvedCase; treatments: ResolvedCase[]; workflows: string[]; mode: 'single-workflow' | 'aggregate'; minRuns: number; allBatches: boolean }`
  - `export function datasetCsv(cells: Cell[], metrics: ComparisonMetric[], spec: ComparisonSpec): string` — header `case,workflow,batch,run,<metric keys in registry order>`; one row per usable run; row order: control first then treatments by caseName, then workflow (numeric id), then batch, then run number; numbers via `String(n)`; missing values are empty cells; `\n` newlines, trailing `\n`. The `case` column holds `shortName`.
  - `export function manifestJson(args: { spec: ComparisonSpec; metrics: ComparisonMetric[]; cells: Cell[]; agentEvalRoot: string; provenance: Record<string, unknown> }): string` — canonical JSON (2-space, trailing `\n`) with EXACTLY this top-level key order: `spec`, `metrics`, `family`, `cells`, `excludedRuns`. `provenance` is appended LAST. `family` is the headline-test list `[{ metric, treatment }]` (registry order × treatments order). `cells` entries: `{ case, workflow, batch, usableRuns, unanalyzed, stale }`. `excludedRuns` entries: `{ path, reason }` with `path` relative to `agentEvalRoot` (POSIX separators). Nothing outside `provenance` may contain absolute paths or timestamps.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { COMPARISON_METRICS } from '../comparison-metrics.ts';
import type { Cell } from './cells.ts';
import type { ResolvedCase } from './resolve.ts';
import { datasetCsv, manifestJson, type ComparisonSpec } from './emit.ts';

const CONTROL: ResolvedCase = {
	caseName: 'cc-control-none-opus-high',
	experiment: 'agentic-ref-cc-control-none-opus-high',
	shortName: 'control-none',
};
const TREATMENT: ResolvedCase = {
	caseName: 'cc-do-dont-opus-high',
	experiment: 'agentic-ref-cc-do-dont-opus-high',
	shortName: 'do-dont',
};

const SPEC: ComparisonSpec = {
	control: CONTROL,
	treatments: [TREATMENT],
	workflows: ['703-fix-bug-flow'],
	mode: 'single-workflow',
	minRuns: 1,
	allBatches: false,
};

function cell(resolvedCase: ResolvedCase, values: number[]): Cell {
	return {
		case: resolvedCase,
		workflow: '703-fix-bug-flow',
		batch: '2026-08-05T00-00-00.000Z',
		runs: values.map((v, i) => ({
			run: {
				runDir: `/root/results/${resolvedCase.experiment}/2026-08-05T00-00-00.000Z/703-fix-bug-flow/run-${i + 1}`,
				projectDir: '',
				experiment: resolvedCase.experiment,
				model: '',
				timestamp: '2026-08-05T00-00-00.000Z',
				evalName: '703-fix-bug-flow',
				run: i + 1,
			},
			analysis: { speed: { durationSeconds: v } },
		})),
		excluded: [{ runDir: `/root/results/${resolvedCase.experiment}/x/run-9`, reason: 'infra-failure' }],
		unanalyzed: 0,
		stale: 0,
		passed: values.length,
		failed: 1,
	};
}

describe('datasetCsv', () => {
	it('emits control rows first with metric columns in registry order', () => {
		const csv = datasetCsv([cell(TREATMENT, [5]), cell(CONTROL, [7])], COMPARISON_METRICS, SPEC);
		const lines = csv.split('\n');
		expect(lines[0]).toBe(
			`case,workflow,batch,run,${COMPARISON_METRICS.map((m) => m.key).join(',')}`,
		);
		expect(lines[1]!.startsWith('control-none,703-fix-bug-flow,2026-08-05T00-00-00.000Z,1,7')).toBe(
			true,
		);
		expect(lines[2]!.startsWith('do-dont,')).toBe(true);
		expect(csv.endsWith('\n')).toBe(true);
		// durationSeconds filled, every other metric column empty
		expect(lines[1]!.split(',').filter((v) => v !== '')).toHaveLength(5);
	});
});

describe('manifestJson', () => {
	it('is canonical: fixed key order, relative paths, provenance last', () => {
		const json = manifestJson({
			spec: SPEC,
			metrics: COMPARISON_METRICS,
			cells: [cell(CONTROL, [7]), cell(TREATMENT, [5])],
			agentEvalRoot: '/root',
			provenance: { generatedAt: 'sometime' },
		});
		const parsed = JSON.parse(json);
		expect(Object.keys(parsed)).toEqual(['spec', 'metrics', 'family', 'cells', 'excludedRuns', 'provenance']);
		expect(parsed.family[0]).toEqual({ metric: 'durationSeconds', treatment: 'do-dont' });
		expect(parsed.family).toHaveLength(COMPARISON_METRICS.length);
		expect(parsed.excludedRuns[0].path.startsWith('results/')).toBe(true);
		expect(json.endsWith('\n')).toBe(true);
		expect(JSON.stringify(parsed, null, 2) + '\n').toBe(json);
	});

	it('produces identical output for identical input (repeatability)', () => {
		const args = {
			spec: SPEC,
			metrics: COMPARISON_METRICS,
			cells: [cell(CONTROL, [7])],
			agentEvalRoot: '/root',
			provenance: {},
		};
		expect(manifestJson(args)).toBe(manifestJson(args));
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/emit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `emit.ts`**

```ts
import { relative, sep } from 'node:path';

import { metricValueAt, type ComparisonMetric } from '../comparison-metrics.ts';
import type { Cell } from './cells.ts';
import type { ResolvedCase } from './resolve.ts';

export interface ComparisonSpec {
	control: ResolvedCase;
	treatments: ResolvedCase[];
	workflows: string[];
	mode: 'single-workflow' | 'aggregate';
	minRuns: number;
	allBatches: boolean;
}

function orderedCells(cells: Cell[], spec: ComparisonSpec): Cell[] {
	const caseRank = (c: ResolvedCase) =>
		c.caseName === spec.control.caseName ? '' : c.caseName;
	return [...cells].sort(
		(a, b) =>
			caseRank(a.case).localeCompare(caseRank(b.case)) ||
			a.workflow.localeCompare(b.workflow) ||
			a.batch.localeCompare(b.batch),
	);
}

export function datasetCsv(
	cells: Cell[],
	metrics: ComparisonMetric[],
	spec: ComparisonSpec,
): string {
	const header = ['case', 'workflow', 'batch', 'run', ...metrics.map((m) => m.key)];
	const lines = [header.join(',')];
	for (const cell of orderedCells(cells, spec)) {
		for (const usable of [...cell.runs].sort(
			(a, b) => a.run.timestamp.localeCompare(b.run.timestamp) || a.run.run - b.run.run,
		)) {
			const values = metrics.map((metric) => {
				const value = metricValueAt(usable.analysis, metric.path);
				return value === null ? '' : String(value);
			});
			lines.push(
				[cell.case.shortName, cell.workflow, usable.run.timestamp, String(usable.run.run), ...values].join(','),
			);
		}
	}
	return lines.join('\n') + '\n';
}

function toPosix(path: string): string {
	return path.split(sep).join('/');
}

export function manifestJson(args: {
	spec: ComparisonSpec;
	metrics: ComparisonMetric[];
	cells: Cell[];
	agentEvalRoot: string;
	provenance: Record<string, unknown>;
}): string {
	const { spec, metrics, cells, agentEvalRoot, provenance } = args;
	const ordered = orderedCells(cells, spec);
	const manifest = {
		spec: {
			control: spec.control,
			treatments: spec.treatments,
			workflows: spec.workflows,
			mode: spec.mode,
			minRuns: spec.minRuns,
			allBatches: spec.allBatches,
		},
		metrics,
		// The BH family: every headline test of this invocation, in test order.
		family: metrics.flatMap((metric) =>
			spec.treatments.map((treatment) => ({ metric: metric.key, treatment: treatment.shortName })),
		),
		cells: ordered.map((cell) => ({
			case: cell.case.shortName,
			workflow: cell.workflow,
			batch: cell.batch,
			usableRuns: cell.runs.length,
			passed: cell.passed,
			failed: cell.failed,
			unanalyzed: cell.unanalyzed,
			stale: cell.stale,
		})),
		excludedRuns: ordered.flatMap((cell) =>
			cell.excluded.map((excluded) => ({
				path: toPosix(relative(agentEvalRoot, excluded.runDir)),
				reason: excluded.reason,
			})),
		),
		provenance,
	};
	return JSON.stringify(manifest, null, 2) + '\n';
}
```

Note the family ordering in the test: metrics outer, treatments inner. The test asserts `family` length = 20 for one treatment.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/emit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/emit.ts agent-eval/lib/agentic-reference/comparison/emit.test.ts
git commit -m "feat: canonical dataset and manifest emission"
```

---

### Task 8: uv setup script and pnpm wiring

**Files:**
- Create: `agent-eval/scripts/setup-compare-stats.mts`
- Create: `agent-eval/lib/agentic-reference/comparison/uv.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/uv.test.ts`
- Modify: `agent-eval/package.json` (scripts), `agent-eval/.gitignore`

**Interfaces:**
- Produces: `export function findUv(): string | null` in `uv.ts` — returns `'uv'` if `uv --version` succeeds, else the absolute `~/.local/bin/uv` if that binary responds, else null. Both `setup-compare-stats.mts` and Task 10's CLI consume it.

- [ ] **Step 1: Write the failing test for `findUv`**

`agent-eval/lib/agentic-reference/comparison/uv.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync }));

import { findUv } from './uv.ts';

describe('findUv', () => {
	it('returns "uv" when the binary is on PATH', () => {
		execFileSync.mockImplementation(() => Buffer.from('uv 0.9.0'));
		expect(findUv()).toBe('uv');
	});

	it('falls back to ~/.local/bin/uv, then null', () => {
		execFileSync.mockImplementation((cmd: string) => {
			if (cmd === 'uv') throw Object.assign(new Error('nope'), { code: 'ENOENT' });
			return Buffer.from('uv 0.9.0');
		});
		expect(findUv()).toMatch(/\.local\/bin\/uv$/);

		execFileSync.mockImplementation(() => {
			throw Object.assign(new Error('nope'), { code: 'ENOENT' });
		});
		expect(findUv()).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/uv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `uv.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Locate the uv binary: PATH first, then the official installer's default target. */
export function findUv(): string | null {
	for (const candidate of ['uv', join(homedir(), '.local', 'bin', 'uv')]) {
		try {
			execFileSync(candidate, ['--version'], { stdio: 'ignore' });
			return candidate;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/uv.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `agent-eval/scripts/setup-compare-stats.mts`**

```ts
// Installs uv (the only prerequisite of the Python statistics stage) and
// prefetches the interpreter + locked dependencies, so `pnpm results:compare`
// works offline afterwards. Users never touch Python tooling directly.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { findUv } from '../lib/agentic-reference/comparison/uv.ts';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

let uv = findUv();
if (uv === null) {
	console.log('The Python statistics stage needs uv (https://docs.astral.sh/uv/).');
	console.log('Installing it with the official installer (https://astral.sh/uv/install.sh)...');
	const install = spawnSync('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
		stdio: 'inherit',
	});
	if (install.status !== 0) {
		console.error('uv installation failed. Install it manually, then re-run this script.');
		process.exit(1);
	}
	uv = findUv();
	if (uv === null) {
		console.error('uv installed but not found on PATH or in ~/.local/bin. Open a new shell and re-run.');
		process.exit(1);
	}
}

console.log('Prefetching the Python interpreter and locked dependencies...');
execFileSync(uv, ['sync', '--script', join(scriptsDir, 'compare_stats.py')], { stdio: 'inherit' });
console.log('Done. `pnpm results:compare` is ready.');
```

- [ ] **Step 6: Wire package.json and .gitignore**

In `agent-eval/package.json` scripts, after `"results:analyze"`:

```json
		"results:compare": "node ./scripts/compare-results.ts",
		"results:compare:setup": "node ./scripts/setup-compare-stats.mts",
```

(`results:compare` targets Task 10's file; until that task lands the script entry simply points at a not-yet-existing file — acceptable, it ships in the same PR.)

In `agent-eval/.gitignore`, after `results/`:

```
# results:compare output; regenerable from results/ + the committed pipeline.
comparisons/
```

- [ ] **Step 7: Run the setup script for real**

Run: `pnpm --dir agent-eval run results:compare:setup`
Expected: uv installs (or is found), then `uv sync --script` FAILS because `compare_stats.py` doesn't exist yet — that's the expected state boundary for this task. Verify manually that `uv --version` (or `~/.local/bin/uv --version`) now prints a version. If the sandbox blocks the installer download, note it and let Task 9's step 4 complete the sync.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --dir agent-eval run typecheck
git add agent-eval/scripts/setup-compare-stats.mts agent-eval/lib/agentic-reference/comparison/uv.ts agent-eval/lib/agentic-reference/comparison/uv.test.ts agent-eval/package.json agent-eval/.gitignore
git commit -m "feat: uv setup script and results:compare pnpm wiring"
```

---

### Task 9: Python statistics stage

**Files:**
- Create: `agent-eval/scripts/compare_stats.py`
- Create (generated): `agent-eval/scripts/compare_stats.py.lock`

**Interfaces:**
- Consumes: a staging directory (argv[1]) containing `dataset.csv` + `manifest.json` in Task 7's formats.
- Produces (into the same directory): `estimates.csv`, `estimates.json`, `report.md`, `curves/<metricKey>@<workflow>.svg` + `.png`. Also merges runtime versions into `manifest.json`'s `provenance` (keys `python`, `pandas`, `statsmodels`, `matplotlib`) and rewrites it canonically (2-space, trailing newline).
- Estimate row fields (CSV column order and JSON keys): `metric`, `treatment`, `scope` (`pooled` or a workflow name), `context` (`true`/`false`), `nControl`, `nTreatment`, `beta`, `se`, `ciLow`, `ciHigh`, `pctChange` (empty unless transform is log/log0), `p`, `q` (empty for context rows), `verdict` (`significant` / `not-significant` / empty for context rows), `direction`, `transform`, `anomalies` (count of dropped ≤0 values for log metrics).

- [ ] **Step 1: Write `agent-eval/scripts/compare_stats.py`**

The complete script (single file; every section below goes in, in this order):

```python
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "pandas>=2.2",
#   "statsmodels>=0.14",
#   "matplotlib>=3.9",
# ]
# ///
"""Statistics stage of `pnpm results:compare`.

Reads dataset.csv + manifest.json from the staging directory given as argv[1];
writes estimates.csv/json, report.md, and curves/ back into it. Deterministic:
no seeds, no wall-clock values outside the manifest provenance block.
Spec: docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md
"""

import csv
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels
import statsmodels.formula.api as smf
from statsmodels.stats.multitest import multipletests

ALPHA = 0.05


def fmt(value):
    """Canonical cell for CSV/JSON: repr for floats, '' for None."""
    if value is None:
        return ""
    if isinstance(value, float):
        return repr(value)
    return str(value)


def transform_series(series, transform):
    """Apply the registry transform; returns (values, anomaly_mask)."""
    if transform == "log":
        anomalies = series.notna() & (series <= 0)
        values = np.where(series > 0, np.log(series.where(series > 0)), np.nan)
        return pd.Series(values, index=series.index), anomalies
    if transform == "log0":
        values = np.where(series == 0, 0.0, np.log(series.where(series > 0)))
        return pd.Series(values, index=series.index), series.notna() & (series < 0)
    return series, pd.Series(False, index=series.index)


def fit_pair(frame, control, treatment, pooled):
    """OLS with HC3 on control+treatment rows; returns the treatment term stats."""
    formula = f'y ~ C(case, Treatment(reference="{control}"))'
    if pooled:
        formula += " + C(workflow)"
    fit = smf.ols(formula, frame).fit(cov_type="HC3")
    term = f'C(case, Treatment(reference="{control}"))[T.{treatment}]'
    ci_low, ci_high = fit.conf_int(alpha=ALPHA).loc[term]
    return {
        "beta": float(fit.params[term]),
        "se": float(fit.bse[term]),
        "ciLow": float(ci_low),
        "ciHigh": float(ci_high),
        "p": float(fit.pvalues[term]),
    }


def analyze(manifest, data):
    control = manifest["spec"]["control"]["shortName"]
    treatments = [t["shortName"] for t in manifest["spec"]["treatments"]]
    workflows = manifest["spec"]["workflows"]
    pooled = manifest["spec"]["mode"] == "aggregate"
    rows, skipped = [], []

    for metric in manifest["metrics"]:
        series, anomalies = transform_series(data[metric["key"]], metric["transform"])
        frame = pd.DataFrame(
            {"y": series, "case": data["case"], "workflow": data["workflow"]}
        ).dropna(subset=["y"])
        for treatment in treatments:
            pair = frame[frame["case"].isin([control, treatment])]
            n_control = int((pair["case"] == control).sum())
            n_treatment = int((pair["case"] == treatment).sum())
            if n_control < 2 or n_treatment < 2:
                skipped.append(
                    {
                        "metric": metric["key"],
                        "treatment": treatment,
                        "reason": f"needs >=2 values per arm, have control={n_control}, treatment={n_treatment}",
                    }
                )
                continue
            stats = fit_pair(pair, control, treatment, pooled)
            rows.append(
                {
                    "metric": metric["key"],
                    "treatment": treatment,
                    "scope": "pooled" if pooled else workflows[0],
                    "context": False,
                    "nControl": n_control,
                    "nTreatment": n_treatment,
                    **stats,
                    "pctChange": (
                        math.exp(stats["beta"]) - 1
                        if metric["transform"] in ("log", "log0")
                        else None
                    ),
                    "q": None,
                    "verdict": None,
                    "direction": metric["direction"],
                    "transform": metric["transform"],
                    "anomalies": int(anomalies[data["case"].isin([control, treatment])].sum()),
                }
            )
            if pooled:
                for workflow in workflows:
                    sub = pair[pair["workflow"] == workflow]
                    if (sub["case"] == control).sum() < 2 or (sub["case"] == treatment).sum() < 2:
                        continue
                    context_stats = fit_pair(sub, control, treatment, pooled=False)
                    rows.append(
                        {
                            "metric": metric["key"],
                            "treatment": treatment,
                            "scope": workflow,
                            "context": True,
                            "nControl": int((sub["case"] == control).sum()),
                            "nTreatment": int((sub["case"] == treatment).sum()),
                            **context_stats,
                            "pctChange": (
                                math.exp(context_stats["beta"]) - 1
                                if metric["transform"] in ("log", "log0")
                                else None
                            ),
                            "q": None,
                            "verdict": None,
                            "direction": metric["direction"],
                            "transform": metric["transform"],
                            "anomalies": None,
                        }
                    )

    headline = [row for row in rows if not row["context"]]
    if headline:
        _, q_values, _, _ = multipletests(
            [row["p"] for row in headline], alpha=ALPHA, method="fdr_bh"
        )
        for row, q in zip(headline, q_values):
            row["q"] = float(q)
            row["verdict"] = "significant" if q <= ALPHA else "not-significant"
    return rows, skipped


ESTIMATE_FIELDS = [
    "metric", "treatment", "scope", "context", "nControl", "nTreatment",
    "beta", "se", "ciLow", "ciHigh", "pctChange", "p", "q", "verdict",
    "direction", "transform", "anomalies",
]


def write_estimates(out_dir, rows):
    with open(out_dir / "estimates.csv", "w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(ESTIMATE_FIELDS)
        for row in rows:
            writer.writerow([fmt(row[field]) if not isinstance(row[field], bool) else str(row[field]).lower() for field in ESTIMATE_FIELDS])
    (out_dir / "estimates.json").write_text(json.dumps(rows, indent=2) + "\n")


def draw_curves(out_dir, manifest, data, rows):
    plt.rcParams["svg.hashsalt"] = "agentic-ref"
    curves_dir = out_dir / "curves"
    curves_dir.mkdir(exist_ok=True)
    control = manifest["spec"]["control"]["shortName"]
    treatments = [t["shortName"] for t in manifest["spec"]["treatments"]]
    for metric in manifest["metrics"]:
        for workflow in manifest["spec"]["workflows"]:
            fig, ax = plt.subplots(figsize=(7, 4.5))
            plotted = False
            has_zero = False
            for case in [control, *treatments]:
                values = data[(data["case"] == case) & (data["workflow"] == workflow)][
                    metric["key"]
                ].dropna()
                if values.empty:
                    continue
                plotted = True
                has_zero = has_zero or bool((values <= 0).any())
                xs = np.sort(values.to_numpy())
                ys = np.arange(1, len(xs) + 1) / len(xs)
                ax.step(
                    xs, ys, where="post",
                    label=f"{case} (n={len(xs)}, med={fmt(float(np.median(xs)))})",
                )
            if not plotted:
                plt.close(fig)
                continue
            if metric["transform"] in ("log", "log0") and not has_zero:
                ax.set_xscale("log")
            ax.set_title(f'{metric["label"]} — {workflow}')
            ax.set_ylabel("ECDF")
            ax.legend(loc="lower right", fontsize=8)
            verdicts = [
                f'{row["treatment"]}: q={fmt(row["q"])} {row["verdict"]}'
                for row in rows
                if row["metric"] == metric["key"] and not row["context"] and row["q"] is not None
            ]
            if verdicts:
                ax.text(
                    0.02, 0.98, "\n".join(verdicts), transform=ax.transAxes,
                    va="top", fontsize=8, family="monospace",
                )
            fig.tight_layout()
            base = curves_dir / f'{metric["key"]}@{workflow}'
            fig.savefig(f"{base}.svg", metadata={"Date": None})
            fig.savefig(f"{base}.png", metadata={"Software": None})
            plt.close(fig)


def write_report(out_dir, manifest, rows, skipped):
    spec = manifest["spec"]
    lines = [
        f'# Comparison: {spec["control"]["shortName"]} vs {"+".join(t["shortName"] for t in spec["treatments"])}',
        "",
        f'Workflows: {", ".join(spec["workflows"])} — mode: {spec["mode"]}, min runs: {spec["minRuns"]}, batches: {"all" if spec["allBatches"] else "latest"}.',
        "",
        "## Verdicts",
        "",
        "| Metric | Treatment | β | 95% CI | % change | p | q | Verdict |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        if row["context"]:
            continue
        arrow = "↓" if row["beta"] < 0 else "↑"
        lines.append(
            f'| {row["metric"]} | {row["treatment"]} | {fmt(row["beta"])} {arrow} '
            f'| [{fmt(row["ciLow"])}, {fmt(row["ciHigh"])}] | {fmt(row["pctChange"])} '
            f'| {fmt(row["p"])} | {fmt(row["q"])} | {row["verdict"]} |'
        )
    if any(row["transform"] == "log0" and not row["context"] for row in rows):
        lines += ["", "% change is approximate for log0 metrics (log(0) is mapped to 0)."]
    context_rows = [row for row in rows if row["context"]]
    if context_rows:
        lines += ["", "## Per-workflow context (not FDR-tested)", "",
                  "| Metric | Treatment | Workflow | β | p |", "|---|---|---|---|---|"]
        for row in context_rows:
            lines.append(
                f'| {row["metric"]} | {row["treatment"]} | {row["scope"]} | {fmt(row["beta"])} | {fmt(row["p"])} |'
            )
    if skipped:
        lines += ["", "## Skipped metrics", ""]
        lines += [f'- {s["metric"]} × {s["treatment"]}: {s["reason"]}' for s in skipped]
    if manifest.get("excludedRuns"):
        lines += ["", "## Excluded runs", ""]
        lines += [f'- `{e["path"]}` — {e["reason"]}' for e in manifest["excludedRuns"]]
    lines += ["", "## Cells", "", "| Case | Workflow | Batch | Usable | Passed | Failed | Unanalyzed | Stale |", "|---|---|---|---|---|---|---|---|"]
    for cell in manifest["cells"]:
        lines.append(
            f'| {cell["case"]} | {cell["workflow"]} | {cell["batch"]} | {cell["usableRuns"]} '
            f'| {cell["passed"]} | {cell["failed"]} | {cell["unanalyzed"]} | {cell["stale"]} |'
        )
    lines += ["", "Curves: see `curves/<metric>@<workflow>.svg`.", ""]
    (out_dir / "report.md").write_text("\n".join(lines))


def main():
    out_dir = Path(sys.argv[1])
    manifest = json.loads((out_dir / "manifest.json").read_text())
    data = pd.read_csv(out_dir / "dataset.csv", dtype={"case": str, "workflow": str, "batch": str})
    rows, skipped = analyze(manifest, data)
    write_estimates(out_dir, rows)
    draw_curves(out_dir, manifest, data, rows)
    write_report(out_dir, manifest, rows, skipped)
    manifest["provenance"] = {
        **manifest.get("provenance", {}),
        "python": sys.version.split()[0],
        "pandas": pd.__version__,
        "statsmodels": statsmodels.__version__,
        "matplotlib": matplotlib.__version__,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    significant = sum(1 for row in rows if row["verdict"] == "significant")
    headline = sum(1 for row in rows if not row["context"])
    print(f"{headline} headline tests, {significant} significant at FDR 5%.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate the lockfile**

Run (uv from Task 8; use the `~/.local/bin/uv` path if not on PATH):
`cd agent-eval && uv lock --script scripts/compare_stats.py`
Expected: creates `agent-eval/scripts/compare_stats.py.lock`. Then complete the Task 8 sync if it was deferred: `uv sync --script scripts/compare_stats.py`.

- [ ] **Step 3: Smoke-test on a hand-made staging dir**

Create `/tmp/claude-1000/-home-steve-Development-mcp/*/scratchpad/smoke/` (use the session scratchpad) containing a minimal `manifest.json` + `dataset.csv`: control `control-none` and treatment `do-dont`, workflow `703-fix-bug-flow`, mode `single-workflow`, one metric entry (`durationSeconds`, transform `log`) in `metrics`, 10 rows per case with treatment values exactly double the control values (e.g. control 100,101,…,109; treatment 200,202,…,218). Run:

`uv run --frozen agent-eval/scripts/compare_stats.py <smoke-dir>`

Expected: exit 0; `estimates.csv` has one headline row with `beta` ≈ `0.693` (log 2), `verdict` `significant`; `curves/durationSeconds@703-fix-bug-flow.svg` and `.png` exist; `report.md` renders the verdict table. Run it twice and `diff -r` the outputs (excluding manifest.json) — must be byte-identical.

- [ ] **Step 4: Commit**

```bash
git add agent-eval/scripts/compare_stats.py agent-eval/scripts/compare_stats.py.lock
git commit -m "feat: Python statistics stage (OLS/HC3, BH-FDR, ECDF curves)"
```

---

### Task 10: CLI front door `compare-results.ts`

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/options.ts`
- Test: `agent-eval/lib/agentic-reference/comparison/options.test.ts`
- Create: `agent-eval/scripts/compare-results.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 3–9.
- Produces:
  - `export interface CompareOptions { control: string | undefined; cases: string | undefined; workflows: string | undefined; minRuns: number; allBatches: boolean; out: string | undefined }`
  - `export function parseCompareArgs(argv: string[]): CompareOptions` — flags `--control=`, `--cases=`, `--workflows=`, `--min-runs=` (positive int, default 10), `--all-batches`, `--out=`; any other argument throws `Unknown argument "<arg>"` (mirrors analyze-results.ts).
  - The CLI honors env override `AGENT_EVAL_RESULTS_DIR` for the results root (used by the integration test) and `AGENT_EVAL_EVALS_DIR` for the evals root.

- [ ] **Step 1: Write the failing options test**

```ts
import { describe, expect, it } from 'vitest';

import { parseCompareArgs } from './options.ts';

describe('parseCompareArgs', () => {
	it('applies defaults', () => {
		expect(parseCompareArgs([])).toEqual({
			control: undefined,
			cases: undefined,
			workflows: undefined,
			minRuns: 10,
			allBatches: false,
			out: undefined,
		});
	});

	it('parses every flag', () => {
		expect(
			parseCompareArgs([
				'--control=control-none',
				'--cases=do-dont,full',
				'--workflows=701,703',
				'--min-runs=5',
				'--all-batches',
				'--out=/tmp/x',
			]),
		).toEqual({
			control: 'control-none',
			cases: 'do-dont,full',
			workflows: '701,703',
			minRuns: 5,
			allBatches: true,
			out: '/tmp/x',
		});
	});

	it('rejects unknown arguments and bad min-runs', () => {
		expect(() => parseCompareArgs(['--nope'])).toThrow('Unknown argument "--nope"');
		expect(() => parseCompareArgs(['--min-runs=0'])).toThrow(/min-runs/);
		expect(() => parseCompareArgs(['--min-runs=x'])).toThrow(/min-runs/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/options.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `options.ts`**

```ts
export interface CompareOptions {
	control: string | undefined;
	cases: string | undefined;
	workflows: string | undefined;
	minRuns: number;
	allBatches: boolean;
	out: string | undefined;
}

export function parseCompareArgs(argv: string[]): CompareOptions {
	const options: CompareOptions = {
		control: undefined,
		cases: undefined,
		workflows: undefined,
		minRuns: 10,
		allBatches: false,
		out: undefined,
	};
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		if (flag === '--all-batches') options.allBatches = true;
		else if (flag === '--control' && value) options.control = value;
		else if (flag === '--cases' && value) options.cases = value;
		else if (flag === '--workflows' && value) options.workflows = value;
		else if (flag === '--out' && value) options.out = value;
		else if (flag === '--min-runs' && value) {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isInteger(parsed) || parsed < 1) {
				throw new Error(`--min-runs must be a positive integer; received "${value}"`);
			}
			options.minRuns = parsed;
		} else throw new Error(`Unknown argument "${arg}"`);
	}
	return options;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `agent-eval/scripts/compare-results.ts`**

```ts
// results:compare — compares a control case against treatment cases over
// recorded run artifacts and produces estimates, FDR verdicts, and curves.
// Orchestration only: resolution/gating/emission logic lives in
// lib/agentic-reference/comparison/, statistics in scripts/compare_stats.py.
// Spec: docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONTROL_CASE } from '../lib/agentic-reference/cases.ts';
import { COMPARISON_METRICS } from '../lib/agentic-reference/comparison-metrics.ts';
import { autoSelectWorkflows, buildCells } from '../lib/agentic-reference/comparison/cells.ts';
import { formatGapTable, remediationCommands } from '../lib/agentic-reference/comparison/commands.ts';
import { datasetCsv, manifestJson, type ComparisonSpec } from '../lib/agentic-reference/comparison/emit.ts';
import { parseCompareArgs } from '../lib/agentic-reference/comparison/options.ts';
import {
	comparisonSlug,
	knownWorkflows,
	resolveCase,
	resolveTreatments,
	resolveWorkflows,
} from '../lib/agentic-reference/comparison/resolve.ts';
import { findUv } from '../lib/agentic-reference/comparison/uv.ts';
import { postAnalysis } from '../lib/agentic-reference/post-analysis.ts';
import { findRuns } from '../lib/post-analysis/runs.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = process.env.AGENT_EVAL_RESULTS_DIR ?? join(ROOT, 'results');
const EVALS_DIR = process.env.AGENT_EVAL_EVALS_DIR ?? join(ROOT, 'evals');
const STATS_SCRIPT = join(ROOT, 'scripts', 'compare_stats.py');

function fail(message: string): never {
	console.error(message);
	process.exit(1);
}

async function main() {
	const options = parseCompareArgs(process.argv.slice(2));
	const metricsVersion = postAnalysis.metricsVersion;
	const runs = findRuns(RESULTS_DIR);

	const control = resolveCase(options.control ?? DEFAULT_CONTROL_CASE);
	const experimentsWithData = [...new Set(runs.map((run) => run.experiment))];
	const treatments = resolveTreatments(options.cases, control, experimentsWithData);
	if (treatments.length === 0) {
		fail('No treatment cases with recorded data. Collect runs first: pnpm eval:agentic-ref');
	}
	const cases = [control, ...treatments];

	const known = knownWorkflows(EVALS_DIR);
	const explicit = resolveWorkflows(options.workflows, known);
	let workflows: string[];
	if (explicit === null) {
		const candidates = [...new Set(runs.map((run) => run.evalName))]
			.filter((name) => /^7\d\d-/.test(name))
			.sort();
		const auto = autoSelectWorkflows({
			runs,
			cases,
			candidates,
			minRuns: options.minRuns,
			allBatches: options.allBatches,
			metricsVersion,
		});
		for (const { workflow, gaps } of auto.skipped) {
			console.log(`Skipping ${workflow}: ${gaps.map((g) => `${g.case.shortName} ${g.have}/${g.need} (${g.reason})`).join(', ')}`);
		}
		if (auto.selected.length === 0) {
			const gaps = auto.skipped.flatMap((s) => s.gaps);
			console.error('No workflow has enough data for every selected case.\n');
			console.error(formatGapTable(gaps));
			console.error('\nCollect the missing data:\n');
			for (const command of remediationCommands(gaps)) console.error(`  ${command}`);
			process.exit(1);
		}
		workflows = auto.selected;
		console.log(`Auto-selected workflows: ${workflows.join(', ')}`);
	} else {
		workflows = explicit;
	}

	const { cells, gaps } = buildCells({
		runs,
		cases,
		workflows,
		minRuns: options.minRuns,
		allBatches: options.allBatches,
		metricsVersion,
	});
	if (gaps.length > 0) {
		console.error('Comparison impossible: insufficient usable data.\n');
		console.error(formatGapTable(gaps));
		console.error('\nCollect the missing data, then re-run this command:\n');
		for (const command of remediationCommands(gaps)) console.error(`  ${command}`);
		process.exit(1);
	}

	const spec: ComparisonSpec = {
		control,
		treatments,
		workflows,
		mode: workflows.length > 1 ? 'aggregate' : 'single-workflow',
		minRuns: options.minRuns,
		allBatches: options.allBatches,
	};
	const outDir = options.out ?? join(ROOT, 'comparisons', comparisonSlug(control, treatments, workflows));
	const stagingDir = `${outDir}.staging`;
	rmSync(stagingDir, { recursive: true, force: true });
	mkdirSync(stagingDir, { recursive: true });

	let gitSha: string | null = null;
	try {
		gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
	} catch {
		// Not fatal: provenance only.
	}
	writeFileSync(join(stagingDir, 'dataset.csv'), datasetCsv(cells, COMPARISON_METRICS, spec));
	writeFileSync(
		join(stagingDir, 'manifest.json'),
		manifestJson({
			spec,
			metrics: COMPARISON_METRICS,
			cells,
			agentEvalRoot: ROOT,
			provenance: {
				generatedAt: new Date().toISOString(),
				gitSha,
				metricsVersion: metricsVersion ?? null,
			},
		}),
	);

	const uv = findUv();
	if (uv === null) {
		console.error(`Dataset and manifest written to ${stagingDir}.`);
		console.error('uv is missing, so the statistics stage cannot run here.');
		console.error('Run `pnpm results:compare:setup`, or elsewhere:');
		console.error(`  uv run --frozen scripts/compare_stats.py ${stagingDir}`);
		process.exit(1);
	}
	try {
		execFileSync(uv, ['run', '--frozen', STATS_SCRIPT, stagingDir], { stdio: 'inherit', cwd: ROOT });
	} catch {
		fail(`Statistics stage failed; staging kept at ${stagingDir}. Previous outputs (if any) at ${outDir} are untouched.`);
	}

	rmSync(outDir, { recursive: true, force: true });
	renameSync(stagingDir, outDir);
	console.log(`\nComparison written to ${outDir}`);
	console.log(`Report: ${join(outDir, 'report.md')}`);
}

await main();
```

- [ ] **Step 6: Typecheck and smoke the early-exit path on real data**

Run: `pnpm --dir agent-eval run typecheck && pnpm --dir agent-eval run results:compare -- --workflows=703`
Expected: typecheck passes; the command early-exits non-zero with `stale-analysis` gaps (all recorded runs have unstamped caches) and prints `pnpm results:analyze --recompute --experiment=...` commands. That confirms discovery, gating, and messaging against real artifacts.

- [ ] **Step 7: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/options.ts agent-eval/lib/agentic-reference/comparison/options.test.ts agent-eval/scripts/compare-results.ts
git commit -m "feat: results:compare CLI front door with stage-and-swap publishing"
```

---

### Task 11: Integration and determinism tests

**Files:**
- Create: `agent-eval/lib/agentic-reference/comparison/pipeline.integration.test.ts`

**Interfaces:**
- Consumes: the full pipeline via `node scripts/compare-results.ts` with `AGENT_EVAL_RESULTS_DIR` pointing at a synthetic tree; `postAnalysis.metricsVersion` for stamping; `findUv` for gating.

- [ ] **Step 1: Write the integration test**

Real fs (NOT memfs — a child process must read the tree). Fixture: 10 usable runs per case for `agentic-ref-cc-control-none-opus-high` and `agentic-ref-cc-do-dont-opus-high` on `703-fix-bug-flow`, one timestamp. Planted values: `speed.durationSeconds` control `[100..109]` (planted ×2 for treatment: `[200, 202, ..., 218]`), `cost.cacheHitRate` identical `[0.8..0.89]` in both arms (null effect). All other metrics absent → skipped.

```ts
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { postAnalysis } from '../post-analysis.ts';
import { findUv } from './uv.ts';

const uv = findUv();
const AGENT_EVAL_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CONTROL_EXP = 'agentic-ref-cc-control-none-opus-high';
const TREATMENT_EXP = 'agentic-ref-cc-do-dont-opus-high';
const WF = '703-fix-bug-flow';
const TS = '2026-08-05T00-00-00.000Z';

const CONTROL_DURATIONS = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
const CACHE_HIT_RATES = [0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89];

const root = mkdtempSync(join(tmpdir(), 'agentic-ref-compare-'));
const resultsDir = join(root, 'results');

function plantRun(experiment: string, run: number, durationSeconds: number, cacheHitRate: number) {
	const dir = join(resultsDir, experiment, TS, WF, `run-${run}`);
	mkdirSync(join(dir, 'project'), { recursive: true });
	writeFileSync(join(dir, 'result.json'), JSON.stringify({ status: 'passed' }) + '\n');
	const analysis = { speed: { durationSeconds }, cost: { cacheHitRate } };
	writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n');
	writeFileSync(
		join(dir, 'post-analysis-meta.json'),
		JSON.stringify(
			{ analyzedAt: 'fixture', metricsVersion: postAnalysis.metricsVersion, output: analysis },
			null,
			2,
		) + '\n',
	);
}

CONTROL_DURATIONS.forEach((duration, i) => {
	plantRun(CONTROL_EXP, i + 1, duration, CACHE_HIT_RATES[i]!);
	plantRun(TREATMENT_EXP, i + 1, duration * 2, CACHE_HIT_RATES[i]!);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

function runCompare(outDir: string) {
	execFileSync(
		process.execPath,
		[
			join(AGENT_EVAL_ROOT, 'scripts', 'compare-results.ts'),
			'--cases=do-dont',
			`--workflows=703`,
			`--out=${outDir}`,
		],
		{ env: { ...process.env, AGENT_EVAL_RESULTS_DIR: resultsDir }, stdio: 'pipe' },
	);
}

describe.skipIf(uv === null)('results:compare end to end', () => {
	it('recovers a planted 2x duration effect and leaves the null metric alone', () => {
		const outDir = join(root, 'comparisons', 'a');
		runCompare(outDir);
		const estimates = JSON.parse(readFileSync(join(outDir, 'estimates.json'), 'utf8'));
		const duration = estimates.find(
			(row: { metric: string; context: boolean }) => row.metric === 'durationSeconds' && !row.context,
		);
		// Exactly doubled values: the log-scale effect is exactly log(2).
		expect(duration.beta).toBeCloseTo(Math.log(2), 6);
		expect(duration.verdict).toBe('significant');
		const cache = estimates.find(
			(row: { metric: string }) => row.metric === 'cacheHitRate',
		);
		expect(cache.verdict).toBe('not-significant');
		expect(readFileSync(join(outDir, 'report.md'), 'utf8')).toContain('durationSeconds');
	}, 300_000);

	it('is byte-for-byte deterministic apart from manifest provenance', () => {
		const a = join(root, 'comparisons', 'det-a');
		const b = join(root, 'comparisons', 'det-b');
		runCompare(a);
		runCompare(b);
		for (const file of ['dataset.csv', 'estimates.csv', 'estimates.json', 'report.md']) {
			expect(readFileSync(join(a, file))).toEqual(readFileSync(join(b, file)));
		}
		for (const file of [`curves/durationSeconds@${WF}.svg`, `curves/durationSeconds@${WF}.png`]) {
			expect(readFileSync(join(a, file))).toEqual(readFileSync(join(b, file)));
		}
		const stripProvenance = (dir: string) => {
			const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
			delete manifest.provenance;
			return manifest;
		};
		expect(stripProvenance(a)).toEqual(stripProvenance(b));
	}, 300_000);

	it('early-exits with remediation commands when a cell is short', () => {
		rmSync(join(resultsDir, TREATMENT_EXP, TS, WF, 'run-10'), { recursive: true });
		let output = '';
		try {
			runCompare(join(root, 'comparisons', 'short'));
			expect.unreachable('should have exited non-zero');
		} catch (error) {
			const failed = error as { status: number; stderr: Buffer };
			expect(failed.status).toBe(1);
			output = failed.stderr.toString();
		}
		expect(output).toContain('9/10');
		expect(output).toContain(
			`AGENTIC_REF_FLOW=${WF} AGENTIC_REF_RUNS=10 pnpm eval:agentic-ref ${TREATMENT_EXP}`,
		);
		// Restore for any later test ordering.
		plantRun(TREATMENT_EXP, 10, CONTROL_DURATIONS[9]! * 2, CACHE_HIT_RATES[9]!);
	}, 300_000);
});

describe.skipIf(uv !== null)('without uv', () => {
	it('is skipped on machines lacking uv (run pnpm results:compare:setup)', () => {
		expect(uv).toBeNull();
	});
});
```

Note the PNG/SVG byte-equality assertion: if matplotlib's PNG output proves non-deterministic despite the `metadata` overrides, drop only the `.png` line and leave a comment citing the observed diff — SVG (with `svg.hashsalt`) and all text outputs must stay byte-identical.

- [ ] **Step 2: Run the integration test**

Run: `pnpm --dir agent-eval exec vitest run lib/agentic-reference/comparison/pipeline.integration.test.ts`
Expected: PASS with uv installed (Task 8/9 done); SKIP cleanly if uv is genuinely absent. First run may take ~1–2 min while uv prepares the env.

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm --dir agent-eval run test:run && pnpm --dir agent-eval run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add agent-eval/lib/agentic-reference/comparison/pipeline.integration.test.ts
git commit -m "test: end-to-end planted-effect and determinism tests for results:compare"
```

---

### Task 12: README documentation

**Files:**
- Modify: `agent-eval/README.md` (add a `## Comparing cases (results:compare)` section near the existing agentic-reference usage docs)

- [ ] **Step 1: Write the docs section**

Add, adapting placement to the README's existing structure:

````markdown
## Comparing cases (results:compare)

Compares a control case against treatment cases over recorded run artifacts:
per-metric OLS estimates with HC3 robust errors, Benjamini–Hochberg FDR
verdicts at 5%, and ECDF curves. Reproducible: everything derives from
`results/` alone. Design: `docs/superpowers/specs/2026-08-10-agentic-ref-analysis-pipeline-design.md`.

```shell
pnpm results:compare:setup                  # one-time: installs uv + Python deps
pnpm results:compare                        # control-none vs all cases, auto workflows
pnpm results:compare -- --cases=do-dont --workflows=701          # one pair, one workflow
pnpm results:compare -- --cases=do-dont,full --workflows=701,703 # aggregation mode
pnpm results:compare -- --min-runs=5 --all-batches               # quick look, pooled batches
```

Output lands in `comparisons/<slug>/`: `report.md`, `estimates.csv|json`,
`curves/`, `dataset.csv`, `manifest.json`. When data is missing or analyzed
by an older metrics version, the command exits and prints the exact
`pnpm eval:agentic-ref` / `pnpm results:analyze` commands to run.
````

- [ ] **Step 2: Commit**

```bash
git add agent-eval/README.md
git commit -m "docs: results:compare usage"
```

---

## Self-Review Notes

- **Spec coverage:** default control constant (T3), `--cases` default all (T10 via `resolveTreatments(undefined, ...)`), strict-intersection auto-select (T5/T10), metrics-version gate + stamping + cache/artifact consistency (T2/T5), min-runs gating + grouped remediation commands (T5/T6), latest-batch + `--all-batches` (T5), registry with log/log0/none and strict-positive invariant (T3/T9), pairwise models + explicit Treatment reference + HC3 (T9), pooled + context rows in aggregate mode (T9), BH over the invocation family (T9), annotated ECDFs with linear-axis zero fallback (T9), stage-and-swap + uv-missing path (T10), canonical ordering + provenance quarantine + repo-relative paths (T7/T9), pass/fail counts per cell in manifest + report (T5/T7/T9), log0 %-change approximation footnote (T9), determinism byte test (T11), pinned env via lockfile + `--frozen` (T8/T9), pnpm setup wrapper (T8), gitignored `comparisons/` (T8), docs (T12).
- **Known judgment call:** `family` in the manifest lists metric × treatment pairs before Python filters skipped metrics; the actually-corrected family is the estimates' headline rows. The manifest records the *intended* grid; `estimates.json` records the *realized* one (skipped metrics are listed in the report). If exact-family recording matters more, have `compare_stats.py` rewrite `manifest.family` after filtering — one-line change, noted here for the implementer.
- **Types check:** `ResolvedCase`/`Cell`/`CellGap`/`ComparisonSpec` names and shapes are consistent across Tasks 4–10; `metricValueAt` consumed in T7; `findUv` consumed in T8/T10/T11; `parseCompareArgs` consumed in T10.
