# Agentic-ref analysis pipeline — design

Date: 2026-08-10. Status: approved design, pre-implementation.

## Goal

A reproducible analysis pipeline over recorded run artifacts for the agentic-reference
experiment line: compare a control case against one or more treatment cases (e.g.
`do-dont`, `full`) for a single workflow or an aggregation of workflows, and compute
statistically disciplined verdicts per metric. Everything derives from stored run
artifacts alone — re-running the pipeline on the same artifacts yields identical output.

Definition of done: one command reproducibly generates estimates, FDR-corrected
verdicts, and distribution curves from run artifacts alone; when data is missing it
early-exits printing the exact collection commands.

## Architecture

Two components, one seam:

1. **`scripts/compare-results.ts`** (pnpm script `results:compare`) — the TS front
   door. Discovers runs under `results/` (same layout rules as `analyze-results.ts`:
   `results/<experiment>/<timestamp>/<workflow>/run-N/`), resolves case names against
   `AGENTIC_REF_CASES`, applies batch selection, validates cell sizes, early-exits
   with remediation commands on gaps, extracts curated metrics from each run's
   `analysis.json` into a tidy dataset + manifest, then invokes the Python stage and
   prints the verdict summary and report location.
2. **`scripts/compare_stats.py`** — single-file Python script run via `uv` with
   PEP 723 inline dependencies (pandas, statsmodels, matplotlib). Reads only the
   dataset + manifest; computes estimates (OLS, HC3 robust SEs), Benjamini–Hochberg
   FDR verdicts, and annotated ECDF curves; writes everything into the comparison
   output directory. Never touches `results/`, deterministic (no seeds, no
   timestamps in content), independently re-runnable on a persisted dataset.

Statistical computation deliberately uses established Python libraries rather than
hand-rolled JS (project constraint). The TS side owns everything that requires repo
vocabulary (artifact layout, case definitions, collection-command syntax), which
Python cannot import.

**No Python knowledge required of users.** The only prerequisite is `uv`; the
script's dependencies are declared inline (PEP 723) and uv resolves them on first
run. A pnpm script wraps the setup so users never touch Python tooling:

- `results:compare:setup` → `node scripts/setup-compare-stats.mts` — installs uv
  via the official installer if absent (with a printed explanation), then
  pre-fetches the Python interpreter and dependencies
  (`uv sync --script scripts/compare_stats.py`).
- `results:compare` checks for uv up front and, when missing, exits pointing at
  `pnpm results:compare:setup`.

**Pinned execution environment.** The Python side is fully pinned: a committed
lockfile `scripts/compare_stats.py.lock` (generated with
`uv lock --script scripts/compare_stats.py`), a `requires-python` pin in the
PEP 723 block, and invocation via `uv run --frozen` so dependencies are never
re-resolved on a user's machine. The resolved Python, uv, and dependency
versions are recorded in the manifest's provenance block.

## CLI

```shell
pnpm results:compare --control=control-none --cases=do-dont,full --workflows=701,703
                     [--min-runs=10] [--all-batches] [--out=<dir>]
```

- `--control` — exactly one case. Defaults to the exported constant
  `DEFAULT_CONTROL_CASE` in `lib/agentic-reference/cases.ts`
  (= `cc-control-none-opus-high`), so the flag can be omitted. (The research now
  uses a single control; `control-doc` is abandoned but the flag remains for
  generality.)
- `--cases` — one or more treatment cases, or `all` (= every non-control case
  with recorded data). Defaults to `all` when omitted. Short names (`do-dont`) resolve via `AGENTIC_REF_CASES` to experiment dirs
  (`agentic-ref-cc-do-dont-opus-high`). Unknown names error listing known cases.
  Control appearing in `--cases` is an error.
- `--workflows` — numeric prefixes (`701`) or full names (`701-new-ui-flow`),
  comma-separated, or `all`. One workflow → single-workflow mode; several →
  aggregation mode. Omitted → auto-select by strict intersection: every workflow
  where the control **and every selected treatment** meet `--min-runs`, so the
  selection always satisfies the cell gate by construction. What was selected
  and skipped (and why) is printed. Note the interplay with `--cases` defaulting
  to `all`: one data-poor case shrinks the intersection — narrow `--cases` to
  widen it. An empty intersection early-exits with the gap table and commands.
  Explicitly requested workflows are strict: any gap in them early-exits.
- `--min-runs` — usable runs required per (case, workflow) cell. Default 10
  (matches `AGENTIC_REF_RUNS` batch size).
- `--all-batches` — pool runs across timestamp batches naively. Default off:
  latest batch per cell only (mirrors `results:analyze --latest`). No batch fixed
  effects: no between-batch drift is expected; the flag exists because some old
  batches are stale and pending deletion, after which pooling becomes the norm.
- `--out` — output directory override. Default `agent-eval/comparisons/<slug>/`
  (gitignored) with a deterministic slug, e.g.
  `control-none_vs_do-dont+full@701+703`. Outputs are staged in a sibling
  temporary directory and atomically renamed over `<out>` only on full success;
  a failed rerun leaves the previous good outputs untouched (the error message
  says so) and keeps its staging directory beside them for debugging.

## Comparison resolution and early exit

**Usable run** = its `analysis.json` exists and parses, **and** its analysis was
produced by the current metrics version. Runs with `result.json` status `failed`
and no analysis (sandbox/infra failures) are excluded, never counted toward
`--min-runs`, and listed in the report. Runs that passed but lack `analysis.json`
are a distinct gap type: the offline pass hasn't run.

**Metrics-version gate.** Comparing runs analyzed by different versions of the
metrics code would measure the analyzer, not the treatment. `results:analyze` will
stamp `metricsVersion` (from the experiment's `postAnalysis.metricsVersion`) into
each run's `post-analysis-meta.json` beside `analyzedAt`; the analyzer's per-run
cache also becomes version-aware (mismatch invalidates it, like the existing
baseline check — today only `--recompute` does), and a cache hit recreates
`analysis.json` when it is missing, so cache and artifact can no longer diverge.
`results:compare` requires every
usable run's stamped version to equal the current `postAnalysis.metricsVersion`;
any mismatch or missing stamp (all pre-existing runs) is a "stale analysis" gap
with remediation `pnpm results:analyze --recompute --experiment=<experiment>`.

**Gating.** Every cell in {control ∪ treatments} × selected workflows needs
≥ `--min-runs` usable runs in the selected batch(es). Any shortfall prints a gap
table (cell, have/need, reason) and **all** remediation commands at once, grouped
per case with workflows comma-joined to minimize invocations:

```shell
AGENTIC_REF_FLOW=701-new-ui-flow,703-fix-bug-flow AGENTIC_REF_RUNS=10 \
  pnpm eval:agentic-ref agentic-ref-cc-do-dont-opus-high
pnpm results:analyze --experiment=agentic-ref-cc-do-dont-opus-high
```

then exits non-zero writing nothing. The runner's fingerprint cache makes these
commands safe verbatim: only missing runs execute.

**Pass/fail** is not a tested metric (7xx `EVAL.ts` is only a sanity gate); the
report shows pass/fail counts per cell for context.

## Metric registry

`lib/agentic-reference/comparison-metrics.ts` exports the curated registry. Entry:
`key`, `label`, `path` (dot-path into `analysis.json`), `family`, `transform`
(`log` | `log0` | `none`), `direction` (`lower-better` | `higher-better` |
`neutral`). Only registry metrics enter the test grid.

Transform rule: `log` for strictly positive right-skewed metrics (durations, cost,
tokens); small counts stay in raw levels (`none`) — the estimate reads as a
difference in mean counts, avoiding log1p's fuzzy `1+y` estimand; large counts
that can be 0 use `log0` (log with `log(0)` replaced by 0). Initial set (20):

| # | Path | Transform | Direction |
|---|------|-----------|-----------|
| 1 | `speed.durationSeconds` | log | lower-better |
| 2 | `speed.turns` | none | lower-better |
| 3 | `cost.estimatedCostUsd` | log | lower-better |
| 4 | `cost.inputTokens` | log | lower-better |
| 5 | `cost.outputTokens` | log | lower-better |
| 6 | `cost.cacheHitRate` | none | higher-better |
| 7 | `cost.totalToolCalls` | none | lower-better |
| 8 | `toolUse.buckets.docs` | none | neutral |
| 9 | `toolUse.buckets.exploration` | none | neutral |
| 10 | `toolUse.buckets.edit` | none | neutral |
| 11 | `toolUse.buckets.verification` | none | neutral |
| 12 | `churn.filesEdited` | none | lower-better |
| 13 | `dsCoverage.dsShareOfAllNodes` | none | higher-better |
| 14 | `dsCoverage.dsShareOfComponentNodes` | none | higher-better |
| 15 | `deltaToBaseline.complexity.cyclomatic.delta` | none | lower-better |
| 16 | `deltaToBaseline.complexity.cognitive.delta` | none | lower-better |
| 17 | `deltaToBaseline.complexity.jsxCognitive.delta` | none | lower-better |
| 18 | `deltaToBaseline.diff.sloc.added` | log0 | neutral |
| 19 | `deltaToBaseline.diff.sloc.net` | none | neutral |
| 20 | `deltaToBaseline.diff.filesChanged` | none | neutral |

Proportions and signed deltas stay untransformed. `sloc.added` is the one large
count that can be 0 (ranges 0 to hundreds), hence `log0`.

## Statistical model

Per metric, OLS via statsmodels with `cov_type='HC3'` (small-sample-appropriate
heteroscedasticity-robust SEs; arms have visibly different variances):

- **Pairwise models**: each control-vs-treatment estimate comes from a model over
  only the control's and that treatment's rows — never a joint all-case model.
  Estimates are independent of which other cases the invocation includes.
- **Single-workflow mode**: `y ~ C(case, Treatment(reference=<control>))`; the
  treatment coefficient is the effect. The reference level is always set
  explicitly to the control — patsy's default (first category) must never be
  relied on.
- **Aggregation mode**: headline model
  `y ~ C(case, Treatment(reference=<control>)) + C(workflow)` (pooled average
  treatment effect with workflow scale differences absorbed), plus per-workflow
  re-fits reported as context only — not FDR-tested.
- Registry transform applied to `y`; for log/log0 metrics the report also shows
  the back-transformed effect as % change (`exp(β)−1`; for log0 metrics labeled
  as approximate, since zeros are mapped to 0).
- **Strict-positive invariant for `log` metrics**: a value ≤ 0 in a
  log-transformed metric is a data anomaly, not a modeling case — it is routed
  down the missing-value path, counted, and named per run in the report (silence
  would mask a data bug; `log0` is reserved for metrics where 0 is legitimate).
- **Missing values**: rows lacking a metric's value drop from that metric's model
  only; per-metric n is reported. A metric with any arm having <2 values is
  skipped with a printed reason and excluded from the FDR family.

**FDR.** Benjamini–Hochberg at 5% (`multipletests(..., method='fdr_bh')`) across
the **full invocation grid**: every headline (metric × treatment) test of the
invocation forms one family. Rationale: the report is the unit of inference — its
whole grid is screened as one act, so the correction is scaled to it; per-treatment
families would under-correct exactly in the widest sweeps where FDR protection
matters most. Verdicts are therefore **family-relative**: q depends on the
invocation's grid, and the same pair can receive different q-values in
invocations with different compositions. The manifest records the exact family,
so every verdict is unambiguous about what it was corrected against. The
pair-run-alone invocation is *defined* as the canonical verdict for a
control-vs-treatment pair. Each test reports β, robust SE, 95% CI, p, q, and
verdict (`significant` iff q ≤ 0.05) with direction.

## Outputs

`agent-eval/comparisons/<slug>/`:

- `manifest.json` — comparison spec (control, treatments, workflows, mode,
  min-runs, batch selection), metric registry snapshot, the FDR family, per-cell
  run counts, selected batch timestamps, excluded runs with reasons, and
  **repo-relative** artifact paths. Environment-dependent values — repo git SHA,
  Python/uv/dependency versions, generation time — live in a dedicated
  `provenance` block that is explicitly excluded from the determinism claim:
  identical artifacts produce byte-identical output everywhere *except* that
  block, regardless of checkout location.
- `dataset.csv` — one row per usable run: `case, workflow, batch, run,
  <metric columns…>`, raw untransformed values.
- `estimates.csv` / `estimates.json` — one row per test: metric, treatment,
  workflow scope, n per arm, β, robust SE, CI, % change (log metrics), p, q,
  verdict, direction; per-workflow breakdown rows flagged `context: true`, no q.
- `report.md` — comparison summary; verdict table grouped by metric family with
  direction arrows; per-workflow breakdown tables; pass/fail counts; excluded runs;
  skipped metrics with reasons; links to curves.
- `curves/<metric>@<workflow>.svg` + `.png` — annotated ECDFs, one file per
  (metric, workflow) so each image stands alone: step curves per arm, log-scaled
  x for log metrics (falling back to a linear axis if any plotted arm contains a
  0), per-arm n and median in the legend, workflow name and FDR verdict (q, from
  the headline test) stamped on the figure. Workflows are never overlaid in one
  panel — their scales differ too much.

**Determinism.** Everything emitted uses canonical ordering and serialization:
cases sort by case name, workflows by numeric id, batches by timestamp, runs by
run number, metrics by registry order; JSON is 2-space-indented with the key
order fixed by this spec; CSV and JSON use `\n` newlines; floats serialize at
full precision (Python `repr`). Re-running on the same artifacts must reproduce
every output byte-for-byte, `manifest.json`'s `provenance` block excepted.

## Error handling

- Unknown case/workflow names: immediate error listing valid names.
- `uv` missing: dataset + manifest are written to the staging directory (the
  previous good outputs stay untouched); exit pointing at
  `pnpm results:compare:setup` (or, to run the stats stage elsewhere, the literal
  `uv run --frozen scripts/compare_stats.py <staging-dir>` command).
- Python failure: stderr surfaced, non-zero exit, staging directory left for
  debugging; previous good outputs stay untouched.
- Malformed `analysis.json`: run excluded and reported (same path as infra
  failures), never a crash.

## Testing

- Vitest for all TS logic, colocated per repo convention (`lib/**/*.test.ts`,
  memfs where useful): run discovery + latest-batch selection, case/workflow
  resolution, gating and remediation-command generation (exact command strings
  asserted), dataset/manifest emission.
- Python side: a synthetic-fixture integration test generates a small artifact
  tree with a planted known effect (e.g. treatment duration ×2), runs the full
  pipeline, asserts the estimate's sign/magnitude and that a null metric stays
  non-significant. `skipIf` `uv` is unavailable so CI without Python stays green.
  No separate pytest infrastructure — statsmodels is the tested surface.
- Determinism test: run the full pipeline twice on the same fixture tree and
  assert byte-for-byte identical outputs (`manifest.json` compared with its
  `provenance` block stripped), also gated on `uv` availability.

## Decisions log

- Curves = distribution curves (annotated ECDFs), not forest/power plots.
- Curated metric registry, not auto-discovered leaves.
- Batches: latest per cell by default; `--all-batches` naive pooling for after
  stale data is deleted; no batch fixed effects.
- Aggregation: pooled workflow-fixed-effects headline + per-workflow context.
- Min 10 usable runs per cell, `--min-runs` override.
- Infra failures excluded entirely; pass-rate reported, not tested.
- Single control in practice: `control-none` (control-doc research abandoned);
  `DEFAULT_CONTROL_CASE` constant lets `--control` be omitted; `--cases`
  defaults to `all`.
- Pairwise models per treatment; HC3; explicit `Treatment(reference=<control>)`
  coding; BH family = full invocation grid, verdicts family-relative with the
  pair-alone invocation as a pair's canonical verdict.
- Transforms: `log` for strictly positive skewed metrics; raw levels for small
  counts (no log1p); `log0` (log with `log(0)` → 0) for large zero-capable
  counts. `log` metrics carry a strict-positive invariant (violations become
  reported missing values).
- Metrics-version gate: analyses must carry the current `metricsVersion`;
  stale/unstamped runs remediate via `results:analyze --recompute`. Analyzer
  cache becomes version-aware and re-emits missing `analysis.json` on hits.
- Auto workflow selection = strict intersection (every selected case meets
  min-runs), so selection always satisfies the gate.
- Stage-and-swap output publishing; failures never clobber previous results.
- Python env pinned: committed `compare_stats.py.lock`, `requires-python`,
  `uv run --frozen`; versions recorded in manifest provenance.
- Determinism: canonical ordering/serialization, repo-relative paths,
  environment-dependent values quarantined in the manifest `provenance` block,
  byte-for-byte repeat test.
- Python (uv + pandas/statsmodels/matplotlib) for stats/plots; TS for repo-aware
  orchestration; `results:compare:setup` shields users from Python tooling.
- CodeRabbit review (PR #386): persisted-case identity suggestion rejected —
  experiment directory name stays the sole run-identity key.
