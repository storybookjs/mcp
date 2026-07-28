# Agentic-reference codebase quality metrics — design

**Date:** 2026-07-28
**Status:** approved, ready for implementation planning
**Scope:** Spec A of two. Spec B (Playwright + axe-core accessibility journeys) is deliberately
deferred and will be brainstormed separately.

## Problem

`agent-eval/scripts/analyze-results.mjs` currently computes one placeholder metric (counting
`Button` imports) and writes it to a per-run `analysis.json`. We want automatic per-run collection
of speed, cost, and code-quality metrics for the agentic-reference experiments, so that MCP and
control arms can be compared without hand analysis.

Three constraints shaped the design:

1. **Metrics must be recomputable without re-running evals.** An LLM run costs ~$1.89 and ~7
   minutes. A metric whose only source is a live run cannot be iterated on.
2. **The analyzer script must not know about any particular eval.** Today it hardcodes Mealdrop's
   Button component, the external-repo pin format, and a Button-specific aggregation.
3. **Nothing may leak into the agent's sandbox.** Metric definitions visible to the agent under
   test are gameable.

## Findings that constrain the design

These were verified against the repo and the harness, not assumed. They are recorded because
several contradict reasonable prior beliefs.

### `analysis.json` reaches nothing today

`grep -rl "analysis\.json" node_modules/` returns zero hits. The harness opens `result.json`,
`summary.json`, `transcript.json`, `classification.json`; the playground opens `result.json`,
`summary.json`, `transcript.json`, `index.json`. CI never runs `results:analyze` — it goes straight
from "Check eval results" to `tar -czf`, so on CI the file is never created at all.

The thing that _is_ loaded and injected is `result.json`'s `analysis` **key**, written by
`onRunComplete`. Same word, different artifact.

**Consequence:** a CI step must run `results:analyze` before the tar, or the metrics never leave a
developer's laptop.

### The harness cannot tell us which files changed

`generatedFiles` is built from `git diff HEAD --name-status` inside the sandbox, against a commit
taken _before_ our `setup()` materialises the external repo. It therefore contains the entire
Mealdrop tree, not the agent's changes. `o11y.filesModified` is transcript-derived and misses any
edit made through the shell (`sed -i`, heredoc redirects) — the observed run used both.

**Consequence:** the authoritative changed-file list is a tree diff between the pinned ref and the
collected `project/`. This is the same pass that produces SLoC, so it costs nothing extra.

### Fixture files are uploaded into the agent's workspace

`EXCLUDED_FILES = ['PROMPT.md','EVAL.ts','EVAL.tsx','node_modules','.git']` governs _local fixture
introspection_, not sandbox uploads. Uploads are governed by `IGNORED_PATTERNS` (`.git`, `.next`,
`node_modules`, `.DS_Store`, `*.log`, `build`, `dist`, `pnpm-lock.yaml`, `package-lock.json`) via
`collectLocalFiles`, and `TEST_FILE_PATTERNS = ['EVAL.ts','EVAL.tsx','PROMPT.md']` are held back
until after the agent finishes. `claude-code/agent.js` and `codex/agent.js` both delegate to
`plugin/orchestrator.js`, so this applies to every agent we run.

Any new file added to a fixture directory therefore lands in `/workspace` where the agent can read
it. `shouldExclude` matches on **basename or relative path**, and Mealdrop has a real `src/helpers/`
directory — so `helpers` is an unusable name for an ignore-list entry.

**Consequence:** analysis code is co-located in the fixture but named `post-analysis.ts` and
`__analysis__/`, and both are added to `IGNORED_PATTERNS` through the existing patch.

### Every binary in the collected tree is corrupted

`public/favicon.ico` is 14254 bytes in the ref and 24506 in `project/`; byte 14 changes from `a8`
to `ef bf bd`; the file contains 5125 U+FFFD replacement characters and decodes as valid UTF-8.
`src/assets/images/restaurants.png` goes 886877 → 1610831 bytes. This is lossy UTF-8
decode-and-reencode on the copy-out path, affecting all 17 image/font assets.

**Consequence:** restricting the diff to source extensions is required for correctness, not
tidiness — otherwise every asset reads as changed. Tracked separately as a harness bug; it is a
blocker for Spec B, which needs to actually run the app.

### Complexity aggregation: the mean is the one option ruled out

SonarQube shipped `FUNCTION_COMPLEXITY` ("Complexity / Function",
`COMPLEXITY_IN_FUNCTIONS ÷ FUNCTIONS`), deprecated it in 6.7 and removed it in 2025.4 along with
every other complexity ratio. What survives is `complexity` and `cognitive_complexity`, both
integers. Their docs: _"the overall code's cyclomatic complexity is basically the sum of all
complexity scores calculated at the function level."_

Kuipers & Visser (SQM'07): _"We feel this is a fundamentally flawed number… The average complexity
will invariably be low (e.g. because all setters and getters of a Java system have a complexity of
1), whereas the maintenance problems will occur in the few outliers."_ Shepperd's identity makes it
concrete: splitting one CC-_v_ function into _k_ drives the mean to _(v+k−1)/k_ → 1, so extraction
always lowers the mean whether or not it helped.

Cyclomatic complexity charges +1 per function merely for existing, so an agent adding three trivial
helpers scores "+3 worse". Cognitive Complexity charges zero cost-of-entry and weights nesting
instead; Sonar enables S3776 (cognitive) by default and leaves S1541 (cyclomatic) off.

Fan-in weighting was investigated and **does not exist in any shipped tool**. CCCC's documentation
states the field's position explicitly: combining the terms _"debases the measure by combining two
attributes which can and should be separately measured."_ Kitchenham (1990) found fan-in to be the
non-predictive half of the fan-in/fan-out pair. It will not be built.

Complexity correlates ~0.9 with LOC (Jay et al., ~1.2M files), so a bare complexity delta partly
re-measures verbosity; a density figure against SLoC separates the two.

## Architecture

### Gateway plus per-eval hook

`scripts/analyze-results.mjs` becomes generic. It parses arguments, discovers runs, dispatches to a
per-eval hook, writes `analysis.json`, and renders tables. It contains no knowledge of Mealdrop,
Button components, or external-repo pins.

```
scripts/analyze-results.mjs               generic: args, discovery, dispatch, output
evals/701-agentic-ref-reuse-component-mcp/
  EVAL.ts  PROMPT.md  package.json
  post-analysis.ts                        the hook
  __analysis__/
    tool-taxonomy.ts   shell-segments.ts
    tree-diff.ts       sloc.ts
    cyclomatic.ts      cognitive.ts
    external-ref.ts    baseline.ts        usage.ts
    baselines/<repo>@<sha>.json           committed precomputed baselines
    *.test.ts          __fixtures__/
```

Evals without a `post-analysis.ts` are skipped silently — 47 of the 48 fixtures today.

### Hook contract

```ts
export interface PostAnalysisContext {
  runDir: string; projectDir: string; fixtureDir: string;
  experiment: string; model: string; timestamp: string;
  evalName: string; run: number;
  result: unknown;            // parsed result.json
  readTranscript(): unknown;  // lazy — 142KB per run
}

export function analyzeRun(ctx: PostAnalysisContext): Promise<Record<string, unknown> | null>;
export function summarize?(rows: unknown[]): unknown[];
export function renderTables?(rows: unknown[], summary: unknown[]): void;
```

`summarize` and `renderTables` are optional; the gateway falls back to a generic table of
experiment / timestamp / run / status.

### Language and module loading

Metric modules are TypeScript. `scripts/analyze-results.mjs` imports them directly — Node 24 strips
types on `import './foo.ts'` from a `.mjs` file. This was verified end to end, including importing
the existing `lib/shell-parse.ts`, and `lib/` contains no non-erasable syntax (no enums, namespaces,
parameter properties, or decorators).

This removes the duplication the current script apologises for: `SAFE_GITHUB_PATH` and `validPin`
become real imports from `lib/agentic-reference/external-repo.ts`.

Tests are colocated `*.test.ts`, discovered automatically by the existing `agent-eval` vitest
project (default include, with `.eval-cache/**` and `results/**` excluded). There are no test files
under `evals/` today.

## Metric definitions

### Speed and cost — already recorded, re-exposed

`result.duration`, `o11y.totalTurns`, `metadata.usage.*`, `o11y.toolCalls`, `o11y.totalToolCalls`
are read from `result.json`. The only new value is:

```
cacheHitRate = cacheReadTokens / (inputTokens + cacheWriteTokens + cacheReadTokens)
```

Output tokens are excluded from the denominator because caching applies only to input.

### Tool-use taxonomy

Five buckets: `docs`, `exploration`, `edit`, `verification`, `other`.

Structured tool calls map by normalised name: `file_read`/`glob`/`grep`/`list_dir` → exploration;
`file_edit`/`file_write` → edit; `web_fetch` and any `originalName` matching `^mcp__` → docs.

Shell commands are tokenised with the existing quote-aware `tokenizeShellCommand`, split on `;`,
`&&`, `||`, and `|`, and each segment classified by its head binary after stepping past `ENV=value`
prefixes and `npx`/`pnpm`/`yarn`/`npm [run|exec]` wrappers. One call may contribute to several
buckets.

Three rules that the prototype proved necessary:

- **Segments downstream of a pipe are skipped.** `| head`, `| tail`, `| wc` filter another
  command's output; they are not acts of exploration. Without this rule `npx tsc … | tail -20`
  counts as exploration and a more careful agent scores worse on a lower-is-better metric.
- **A redirect to a path is an edit** regardless of head binary.
- **`sed`/`awk` are ambiguous**: `-i` means edit, otherwise explore.

Heredoc bodies are stripped before tokenising so their contents are not parsed as commands.

Unclassified segment heads are recorded in `toolUse.unclassified` so the taxonomy can be extended
from real data rather than guesswork.

Only raw bucket counts are stored. The documentation-quality proxy itself — exploration relative to
documentation reads — is **deliberately not stored**. It is a pure function of the counts, and the
question it answers is a cross-run comparison between arms rather than a property of any single
run, so it is computed at analysis time over all run logs.

This is a judgement about _this_ ratio, not a blanket rule: `cacheHitRate`, `densityPerSloc`,
`maxEditsPerFile`, `meanEditsPerFile`, and `sloc.net` are also derived, and are retained because
each encodes a non-obvious convention (which tokens form the cache denominator, which complexity
measure pairs with which SLoC figure) that is worth pinning in the artifact rather than
reconstructing.

### Per-file iteration count

Counts `file_edit`/`file_write` calls per `file_path`, plus writes detected in shell segments
(`sed -i`, heredoc and `>` redirects, `cp`, `mv`, `tee`). Shell detection is required: the observed
run edited via `cp` and `sed -i`, and `o11y.filesModified` misses exactly that.

Emits `perFile`, `filesEdited`, `maxEditsPerFile`, `meanEditsPerFile`.

### SLoC diff

Comment- and blank-stripped, source extensions only (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`,
`.css`). Both sides are stripped, then diffed with `diffLines` from `diff` (jsdiff), promoted to an
explicit devDependency. LCS is required: without it every line after an insertion reads as changed.

Physical line counts are not stored.

Excluded paths: `EVAL.ts`, `PROMPT.md`, `__agent_eval__/`, `__metrics__/`, `.npmrc`,
`package-lock.json`, `vitest.config*.ts`, `package.json`, plus all non-source extensions.

### Complexity diff

Both cyclomatic and cognitive complexity, each summed over the changed files, before and after.

The file set is the SLoC changed-file list narrowed to script extensions (`.ts`, `.tsx`, `.js`,
`.jsx`, `.mjs`, `.cjs`) — `.css` participates in SLoC but has no AST to walk. `before` is read from
the committed baseline's entries for exactly those files; `after` is computed from `project/`. A
file the agent created has no baseline entry and contributes `before = 0`.

`complexityForSource` is ported from storybookjs/storybook#35141 (`sidnioulz/mvc-script-and-skill`,
`scripts/sustainability/assess-mvc/cost-benefit/utils/cyclomatic.ts`) with its four unit tests. It
is a self-contained TypeScript-compiler-API walker whose only dependency is `typescript` (5.9.3 is
present). It is dead code in that PR — nothing imports it but its own test — so it is a well-formed
leaf module, not a proven integration. Two known defects to fix on port:

- Every file is parsed as `ScriptKind.TSX`, so generic arrow functions in plain `.ts` files
  (`const f = <T>(x: T) => x`) mis-parse as JSX. Branch on extension.
- `ConstructorDeclaration`, `GetAccessor`, and `SetAccessor` are not treated as function-likes, so
  their bodies are misattributed.

Cognitive complexity is implemented fresh against Appendix B of Sonar's white paper, using
`eslint-plugin-sonarjs/src/rules/cognitive-complexity.ts` as a reference.

Baselines are precomputed per `repo@sha` and committed at
`__analysis__/baselines/<repo>@<sha>.json`, holding every function's cyclomatic and cognitive score
for the whole repo. Computed on cache miss from the ref the analyzer already fetches. A moved pin
produces a new key, so a stale baseline cannot be silently reused.

`densityPerSloc = cognitive.delta / sloc.net` is stored, to separate "wrote more code" from "wrote
denser code".

Files that fail to parse are recorded in `parseFailures`, so a genuine delta of 0 is distinguishable
from a walker that gave up.

## Record shape

```jsonc
{
	"experiment": "agentic-ref-reuse-component-cc-mcp-opus-high",
	"eval": "701-agentic-ref-reuse-component-mcp",
	"run": 1,
	"model": "opus",
	"timestamp": "2026-07-28T12-21-43.772Z",
	"fixtureRef": "yannbf/mealdrop@ce507b345666",
	"pinSource": "run",
	"status": "failed",

	"speed": { "durationSeconds": 403.365, "turns": 12 },

	"cost": {
		"inputTokens": 53157,
		"cacheWriteTokens": 147365,
		"cacheReadTokens": 999884,
		"outputTokens": 8239,
		"totalTokens": 1208645,
		"cacheHitRate": 0.833,
		"estimatedCostUsd": 1.89273325,
		"toolCalls": { "file_read": 4, "file_edit": 3, "shell": 17, "unknown": 1, "...": 0 },
		"totalToolCalls": 25,
	},

	"toolUse": {
		"buckets": { "docs": 1, "exploration": 14, "edit": 8, "verification": 7, "other": 0 },
		"unclassified": [],
	},

	"churn": {
		"perFile": { "src/components/Footer/Footer.tsx": 3 },
		"filesEdited": 1,
		"maxEditsPerFile": 3,
		"meanEditsPerFile": 3,
	},

	"diff": {
		"filesChanged": 1,
		"files": ["src/components/Footer/Footer.tsx"],
		"sloc": { "added": 9, "removed": 1, "net": 8 },
	},

	"complexity": {
		"cyclomatic": { "before": 0, "after": 0, "delta": 0 },
		"cognitive": { "before": 0, "after": 0, "delta": 0 },
		"densityPerSloc": 0,
		"parseFailures": [],
		"baselineKey": "yannbf__mealdrop@ce507b345666ea8678101fccac580186b2b69b1f",
	},

	"buttonImports": { "before": 0, "after": 1, "delta": 1 },
}
```

Complexity values above are placeholders; every other value is the measured result of the stored
run and is the regression target.

## Testing strategy

No layer requires an LLM call. Every metric is a pure function of stored artifacts, so the single
run already on disk becomes a permanent fixture.

| Layer     | Contents                                                                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit      | `cyclomatic` (four tests ported verbatim), `cognitive` (Sonar white-paper Appendix A cases), `sloc` stripping (line/block/JSDoc/JSX comments, template literals and regex literals containing `//`), `tree-diff` over synthetic two-file trees |
| Table     | ~40 shell commands → expected buckets: the 17 real ones plus heredocs, quoted `sed -i`, pipes, `ENV=x` prefixes, `npx`/`pnpm` wrappers, `bash -c` nesting                                                                                      |
| Golden    | 21KB trimmed transcript (tool_call events only) plus `result.json` from the stored run, asserting every measured value in the record above                                                                                                     |
| Smoke     | `pnpm results:analyze --latest` over the real stored run, snapshotting `analysis.json`                                                                                                                                                         |
| Synthetic | Hand-written transcripts for cases we have no run of: zero doc reads (the control arm), shell-only editing, zero edits                                                                                                                         |

The control-arm case is deliberate: no no-MCP run exists on disk, and it exercises the zero-doc-read
path.

### Known-good values from the stored run

```
duration 403.365s · turns 12 · 25 tool calls · $1.8927 · cacheHitRate 0.8330
buckets: docs 1 · exploration 14 · edit 8 · verification 7 · other 0
Footer.tsx edits 3 · sloc +9 / −1 stripped (+10 / −1 physical) · filesChanged 1
```

The agent's entire change is 10 added and 1 removed line in
`src/components/Footer/Footer.tsx` — verified by diffing the fetched ref against `project/`.

## Changes outside the metric modules

- `patches/@vercel__agent-eval@1.2.0.patch` — add `post-analysis.ts` and `__analysis__` to
  `IGNORED_PATTERNS`. Not `helpers`: `shouldExclude` matches on basename and Mealdrop has a real
  `src/helpers/`. The patch already spans five harness files, so this is an established mechanism.
- `.github/workflows/agent-eval.yml` — run `pnpm results:analyze` before `tar -czf`. The step needs
  network access to fetch the pinned ref, which the script already does today via `codeload`.
- `agent-eval/tsconfig.json` — add `evals/**/post-analysis.ts` and `evals/**/__analysis__/**/*.ts`
  to `include`; they are otherwise untypechecked.
- `agent-eval/package.json` — promote `diff` (jsdiff) to an explicit devDependency. It is already
  physically present as a transitive dependency.

## Error handling

- Missing or unparseable `transcript.json` nulls the transcript-derived metrics rather than
  throwing; tree-derived metrics still compute.
- A run with no recoverable external-repo pin is skipped, as today.
- A source file the walker cannot parse is recorded in `parseFailures`, never silently scored 0.
- A missing baseline is computed and written on demand.
- The gateway isolates hook failures per run: one eval's broken `post-analysis.ts` must not abort
  the whole pass.
- `densityPerSloc` is `null` when `sloc.net` is 0. A run that adds and removes equal numbers of
  lines is a real outcome, and must not produce `Infinity` or `NaN` — either would poison any later
  mean across runs. The same applies to `meanEditsPerFile` and `maxEditsPerFile` when the agent
  edited no files: both are `null`, not 0, so "no edits" is distinguishable from "edits that
  averaged zero".

## Out of scope

- **axe-core accessibility violations.** Requires building and serving the app and driving it with
  Playwright through per-eval user journeys, with axe-core injected as a standalone script rather
  than through a runtime-specific wrapper. Blocked in practice by the binary-corruption bug above.
  Separate spec.
- Fan-in-weighted complexity — investigated, does not exist, will not be built.
- LLM-judge columns; the `judged` field remains `null`.
