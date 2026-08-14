# DS misuse metric — design

Status: approved 2026-08-14. Supersedes nothing; extends the agentic-reference
metric family alongside `ds-coverage`.

## Problem

`ds-coverage` measures *how much* of a run's UI comes from the design system. It
cannot say whether the agent used the design system *well*: whether it reached
for the right component, followed the usage guidelines, or hand-rolled something
the DS already provides. Two arms can land on identical DS share while one made
good decisions and the other pasted `<Card>` around markup that wanted
`<PageSection>`.

`ds-misuse` measures the decisions. It is an LLM judge over the JSX nodes a run
introduced, scored against the Droppy design system's own documentation.

## What it measures

Three sub-scores, each `1` / `0.5` / `0` per evaluated node, summarised as a mean
in `[0, 1]`:

| Score                    | Asked of          | Question                                                                       |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| `correct-ds-decision`    | new DS usages     | Was this the right DS component, or did a better DS alternative exist?          |
| `correct-ds-usage`       | new DS usages     | Does this usage violate a documented usage or brand guideline?                  |
| `correct-local-decision` | new local usages  | Should this have been local, or did a DS component with adequate API exist?     |

`0.5` is the ambiguous/debatable band throughout. For `correct-local-decision` it
carries a specific meaning: a DS component exists, but its API does not support a
*legitimate* local use case — legitimate meaning the local component fulfils the
task goal where the DS component's existing API would not.

### Known pre-existing violations are out of scope

The ticket listed a known-violations exclusion list as a third input.
`lib/agentic-reference/KNOWN-ISSUES.md` scoped it to P-2, P-3, E-5 and E-6, but
that catalog was written against a Mealdrop built on a different design system
package than the one the current fixtures pin. It is stale and unsafe to rely on.

**Every violation the judge finds counts.** Nothing is excluded, and the judge is
not given a violations list to reconcile against. Revisit only if the catalog is
regenerated against the Droppy fixtures.

## Inputs

1. **The run's final code state** — the collected tree at
   `results/<experiment>/<model>/<timestamp>/<eval>/run-N/project`.
2. **The baseline** — the pinned upstream tree the run started from, materialised
   from the pin the run itself recorded in `result.json` → `analysis.externalRepo`.
   Never today's fixture pin: reading that would retroactively change historical
   judgements when a fixture moves.
3. **Brand and component usage guidelines** — the Droppy MDX corpus (below).

## Design system guidelines

Sourced from `yannbf/droppy-ds` at **one pinned ref, fixed in code**:
`refs/heads/main` pinned at `dfe7e43eeb2ff25c95897e55e86a976ef3f7cb7d`.

This is deliberately *not* the arm's own `experiment/*` branch. Content variation
between arms is the independent variable of the whole agentic-reference round —
some arms are served deliberately degraded documentation, which is precisely what
we want to detect misuse from. Judging each arm against the docs it was served
would make the arms incomparable, and would score a degraded arm against a
lowered bar. Every arm is judged against the complete guidelines.

At the pinned ref the corpus is 43 `.mdx` files, ~380 KB (~95k tokens):

- 33 component docs, `src/components/<Name>/<Name>.mdx`
- 10 under `src/docs/`, of which the load-bearing four are
  `BrandGuidelines.mdx`, `ChoosingComponents.mdx`, `TechnicalGuidelines.mdx`,
  `AccessibilityGuidelines.mdx`

Fetched with the existing `prepareRef` into `.eval-cache/refs/`, so it is
downloaded once per machine and shared with every other pinned tree.

Moving the pin is a deliberate, reviewable edit. When it moves, previously
written `ds-misuse.json` artifacts become stale — they record the ref they were
judged against, and the CLI treats a ref mismatch as a cache miss.

## Node census — changes to `ds-coverage`

The census currently produces aggregates only: per-file `NodeTotals`, per-identity
counts. The judge needs individual nodes, addressable in a way that survives
relocation.

### The option

`DsCoverageOptions` gains `includeNodes?: boolean`, default `false`. The
`DsCoverageReport` gains `nodes?: NodeRecord[]`, populated only when the option is
set. `scripts/ds-coverage.ts` exposes it as `--nodes`.

Default-off is load-bearing: `measureDsCoverage` (used by `post-analysis.ts` for
every run and every baseline) keeps its current stored shape, so no existing
committed artifact changes and no consumer needs updating.

### The record

```jsonc
{
  "path": "RestaurantCard/div[0]/Card[1]/Button[0]",
  "file": "src/components/RestaurantCard.tsx",
  "line": 166,
  "tag": "Button",
  "category": "ds",
  "module": "@droppy/react",
  "name": "Button",
  "weight": 1,
  "props": ["variant", "size", "onClick"]
}
```

`path` is the identity that matters. It is the name of the enclosing top-level
declaration, followed by the chain of JSX ancestors from that declaration down to
the node, each as `Tag[i]` where `i` is the node's index **among its element
siblings only** (text and expression children do not advance the index). It
carries no line or character offsets, so a node that moved down a file because
something was inserted above it keeps the same path — which is exactly what lets
the judge separate "new" from "moved".

Two spelling rules, so the format is unambiguous:

- **Member expressions** use the full dotted tag text as written — `Card.Header[0]`,
  `Dialog.Root[1]` — not the resolved export name. The path describes the source,
  and the resolved identity already travels beside it in `module`/`name`.
- **Fragments** (`<>` and `<React.Fragment>`) do not appear as path segments and
  do not advance sibling indices, matching the census, which already treats them
  as non-rendering. A node's path is therefore the same whether or not its author
  wrapped a subtree in a fragment.

`props` is prop *names* only, never values. The judge needs to know a `Button`
was given `variant` to check it against the guidelines; it does not need the
value, which it can read in the diff, and which would bloat the record.

Host elements (`div`, `span`, …) are not recorded — the metric is about component
choices. Unresolved elements are not recorded either; they are already reported
separately in `unresolvedElements`, and a node whose identity is unknown cannot
be judged.

### Where each side's census comes from

**Baseline side:** whole tree, `includeNodes` on, measured once per pin and
committed. This is the expensive half, and it is amortised — one baseline backs
roughly 200 experiments in practice.

**Treatment side:** targeted. The CLI passes `censusInclude` set to the files the
tree diff touched, with `includeNodes` on. `analyzeDsCoverage` still builds the
full module graph (identity resolution needs it) but only walks and counts the
touched files, so the output is a handful of files rather than the whole app.
This is sound because a *new* JSX node can only appear in a file the run changed.

## Baseline storage and re-keying

### Re-key baselines on the pin

`baselines/<evalName>/<pinSlug>.json` becomes `baselines/<pinSlug>.json`.

The current per-eval keying is duplication, not information.
`baselines/701-new-ui-flow/…base-ui-v1.json` and
`baselines/703-fix-bug-flow/…base-ui-v1.json` are byte-identical apart from their
`eval` field. The cause is contract generality: `loadOrBuildBaselineAnalysis`
passes `evalName` and `fixtureDir` into `analyzeRun` in baseline mode, so it
cannot assume the result is pin-only — but the agentic-reference baseline branch
reads only `projectDir` and `pin`. The generality is real in the contract and
unused in practice.

`evalName` and `fixtureDir` are removed from `BaselineContext` entirely, so a
future module cannot quietly make a baseline eval-dependent again. `BaselineOptions`
loses `evalName` and `fixtureDir` with it. The three committed files collapse to
two.

`metricsVersion` bumps to **7**, which rebuilds every baseline under the new
definitions rather than comparing across them.

### Node sidecar

The whole-tree node census lands in `baselines/ds-nodes/<pinSlug>.json`, not in
the baseline file itself. The baseline file's own comment asks it to stay small
enough to read in a diff; thousands of node records would end that. Keeping it
beside rather than inside means a reviewer still sees the coverage and complexity
numbers move when a pin moves.

The sidecar records the pin, the `metricsVersion` it was built under, and the
node array. It is built by the same `--recompute` path that rebuilds baselines.

## The CLI — `pnpm judge:ds-misuse`

`scripts/judge-ds-misuse.ts`. Discovers run directories the same way
`scripts/analyze-results.ts` does, and accepts the same selection flags:
`--experiment=<name>`, `--since=<ISO date>`, `--latest`, `--recompute`.

Per run, in order. Each step aborts with a message naming the cause and the fix:

1. **Resolve the pin** from `result.json` → `analysis.externalRepo`. A run that
   recorded no usable pin has no baseline to be judged against; skip it, loudly.
2. **Materialise the pinned tree** via `prepareRef`.
3. **Load the node sidecar** for that pin. Abort if missing or built under a
   different `metricsVersion`, pointing at `pnpm results:analyze --recompute`.
4. **Diff** — `git diff --no-index <baselineDir> <projectDir>`, restricted to the
   source extensions `tree/paths.ts` already defines, with the two tree roots
   rewritten to workspace-relative paths so the judge sees `src/components/Foo.tsx`
   rather than two absolute cache paths. Capped at **512 KB** (~128k tokens, well
   clear of the context window alongside the ~95k-token doc corpus); if the cap
   trips, the diff is cut at a file boundary rather than mid-hunk, the prompt
   carries an explicit marker naming how many files were dropped, and
   `diffTruncated: true` is recorded in the output — so a huge diff degrades
   visibly rather than silently.
5. **Check `ANTHROPIC_API_KEY`.** Abort if unset. This is checked *after* the
   cheap local steps so a misconfigured environment surfaces every other problem
   in the same run rather than one per invocation.
6. **Fetch the DS guidelines** at the pinned ref via `prepareRef`; glob its MDX.
7. **Census the treatment tree**, targeted to the diff's files (above).
8. **Assemble the context package** and call the judge.
9. **Write `ds-misuse.json`** into the run directory.

### Caching

`ds-misuse.json` is itself the cache — a run that has one is skipped unless
`--recompute` is passed or the stored `dsGuidelinesRef` / `metricsVersion` no
longer match the current ones. Judging costs real money; re-running the CLI over
a results tree must not re-spend on runs already judged.

## The judge

One `@anthropic-ai/sdk` call per run.

- **Model** `claude-opus-4-8`, `thinking: {type: "adaptive"}`,
  `output_config: {effort: "high"}`.
- **Structured output** via `output_config.format` with a JSON schema, so the
  scored-node array is schema-guaranteed rather than parsed out of prose.
- **Prompt caching** with `cache_control: {type: "ephemeral", ttl: "1h"}` on the
  DS-MDX block. The corpus is byte-identical across every run and every arm, so a
  sweep pays the write once and reads it at ~0.1× thereafter.

  `1h` is the longest TTL the API offers — the only accepted values are `5m` and
  `1h`. It is nonetheless sufficient for a sweep of any length, because **a cache
  read refreshes the lifetime at no cost**. What has to stay under the TTL is the
  gap between two consecutive judge calls, not the duration of the whole sweep, so
  a sequential pass over hundreds of runs keeps the entry alive indefinitely.

  `1h` is still chosen over the cheaper `5m` default for headroom: the lifetime is
  measured from the *start* of the request that reads it, so generation time counts
  against it. A high-effort call over ~100k tokens of input can run for several
  minutes, which leaves an uncomfortable margin against a five-minute window. The
  trade is a 2× write multiplier instead of 1.25×, paid once.
- **Ordering** — DS docs first (stable, cached), then the run-specific package
  (volatile). Anything volatile placed before the breakpoint would invalidate the
  cache on every request.

### Bucketing is the model's job

Per the ticket, the judge receives the baseline node list, the treatment node
list, and the diff, and decides for itself which nodes are genuinely new versus
relocated — then splits the new ones into DS usages and local usages before
scoring. This is deliberately not computed in code: a deterministic multiset
difference over AST paths was considered and rejected in favour of the ticket's
design, which tolerates paths that shifted in ways code cannot match.

The consequence is accepted: bucketing is not reproducible across two invocations
on the same run. `ds-misuse.json` therefore records the buckets the judge chose,
not just the scores, so a surprising number can be traced back to what it counted.

### Output

`ds-misuse.json`:

```jsonc
{
  "schemaVersion": 1,
  "metricsVersion": 7,
  "judgedAt": "2026-08-14T12:00:00.000Z",
  "model": "claude-opus-4-8",
  "dsGuidelinesRef": "yannbf/droppy-ds@dfe7e43eeb2ff25c95897e55e86a976ef3f7cb7d",
  "fixtureRef": "yannbf/mealdrop@refs/tags/agentic-reference/droppy-70pc-v2",
  "diffTruncated": false,
  "summary": {
    "correctDsDecision": 0.87,
    "correctDsUsage": 0.93,
    "correctLocalDecision": 0.75,
    "evaluated": { "ds": 12, "local": 4 }
  },
  "nodes": [
    {
      "path": "CheckoutSummary/div[0]/Card[0]/Button[1]",
      "file": "src/components/CheckoutSummary.tsx",
      "line": 88,
      "tag": "Button",
      "kind": "ds",
      "correctDsDecision": { "score": 1, "reason": "…" },
      "correctDsUsage": { "score": 0.5, "reason": "…" }
    },
    {
      "path": "CheckoutSummary/div[0]/PriceRow[2]",
      "file": "src/components/CheckoutSummary.tsx",
      "line": 96,
      "tag": "PriceRow",
      "kind": "local",
      "correctLocalDecision": { "score": 0, "reason": "…" }
    }
  ]
}
```

Every summary score is the mean over the nodes that received it, or `null` when
no node of that kind was evaluated — `null` rather than `0`, so "the run created
no local components" is distinguishable from "every local decision was wrong".

Each score carries a `reason`. A bare number is not reviewable, and the first
thing anyone will ask of a surprising score is why.

## Feeding back into `results:analyze`

`analyze-results.ts` never invokes the judge. It documents that every metric it
computes is a pure function of stored artifacts, re-runnable as often as a
definition changes without spending anything on model calls; calling a paid API
from it would break that guarantee. It only *reads* what the judge already wrote.

### The `--misuse` table family

`TABLE_SECTIONS` gains `'misuse'` and `SummarizeOptions` gains a matching
`misuse: boolean`, so `--misuse` selects the family exactly like `--coverage` and
`--complexity` do. `DEFAULT_TABLES` is unchanged (`['coverage']`) — naming any
section already selects exactly that set, so `--misuse` alone prints just these
two tables.

`summarize()` prints the same per-run/grouped pair as the other families:

- **Per-run** — experiment, run, `dsNodes`/`localNodes` evaluated, `decision`,
  `usage`, `localDecision`, and a `judged` marker for runs with no artifact.
- **Grouped** — the arm means of the three scores plus the evaluated-node counts,
  so arms are comparable in one row.

Means follow the existing convention: `numbersAt` drops non-finite values, so an
unjudged run contributes nothing rather than dragging a mean toward zero, and a
score with no evaluated nodes stays `null` rather than becoming `0`.

### Reading the artifact outside the analysis cache

`ds-misuse.json` is read fresh on every invocation and merged into the analysis
row **after** the `post-analysis-meta.json` cache lookup, under a `dsMisuse` key.

This ordering is the whole point. The judge runs *after* `results:analyze` in the
normal workflow, so a row baked into the cache during the first analysis pass
would not contain the scores, and every later `results:analyze` would keep
serving that cached row — the numbers would never appear without `--recompute`.
Merging post-cache means judging a run and then re-running `results:analyze`
picks the scores up immediately.

The merged rows still reach `summary.json` and `results/analysis-summary.json`,
so comparing arms on misuse stays a single read, matching how coverage works.

### The missing-artifact warning

After analysing, if any run it touched has no `ds-misuse.json`,
`analyze-results.ts` prints a **bold red warning** naming the count and the
command to run. This fires regardless of which table families were selected — a
silently absent metric is the failure mode worth shouting about.

## Testing

Following the existing metric modules, which each carry a `*.test.ts` beside them
and use `memfs` for tree fixtures.

- **Node census** — path construction across nesting, fragments, conditional
  branches, and member expressions (`Card.Header`); sibling indexing ignoring text
  and expression children; stability of a path under an insertion above it;
  host and unresolved elements absent from the list; `includeNodes: false`
  producing a byte-identical report to today's.
- **Baseline re-keying** — path derivation from a pin, including refs containing
  slashes; the `metricsVersion` mismatch rebuild path; sidecar read/write.
- **Diff** — path rewriting to workspace-relative, extension filtering,
  truncation marker.
- **CLI** — each abort path fires with its named cause: no pin, missing sidecar,
  stale sidecar version, absent API key.
- **Judge** — the SDK call is mocked. Tests cover context assembly (docs before
  volatile content, cache breakpoint placement), schema validation of a
  well-formed response, summary arithmetic including the `null`-on-empty case, and
  the stale-`dsGuidelinesRef` cache-miss path. No test makes a network call.
- **`--misuse` tables** — `summarize()` renders both tables from rows carrying
  `dsMisuse`; unjudged rows are excluded from means rather than counted as zero;
  the family prints nothing and the warning fires when no row carries the key.
- **Post-cache merge** — the regression this ordering exists to prevent: a run
  analysed *before* it was judged, then judged, then re-analysed without
  `--recompute`, must surface its scores.

## Out of scope

- Judging nodes in files the run did not touch.
- Any use of the stale `KNOWN-ISSUES.md` catalog.
- Adding `misuse` to `DEFAULT_TABLES`. It is opt-in via `--misuse` for now;
  promoting it is a one-line change once a round of real data says it earns the
  terminal space more than `coverage` does.
- Framework support beyond React, which is all `ds-coverage` supports today.
