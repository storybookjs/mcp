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

## CLI

```
pnpm results:compare --control=control-none --cases=do-dont,full --workflows=701,703
                     [--min-runs=10] [--all-batches] [--out=<dir>]
```

- `--control` — exactly one case. Default `control-none`. (The research now uses a
  single control; `control-doc` is abandoned but the flag remains for generality.)
- `--cases` — one or more treatment cases, or `all` (= every non-control case
  with recorded data). Short names (`do-dont`) resolve via `AGENTIC_REF_CASES` to experiment dirs
  (`agentic-ref-cc-do-dont-opus-high`). Unknown names error listing known cases.
  Control appearing in `--cases` is an error.
- `--workflows` — numeric prefixes (`701`) or full names (`701-new-ui-flow`),
  comma-separated, or `all`. One workflow → single-workflow mode; several →
  aggregation mode. Omitted → auto-select every workflow where the control and at
  least one treatment both have data, printing what was selected and skipped.
  Explicitly requested workflows are strict: any gap in them early-exits.
- `--min-runs` — usable runs required per (case, workflow) cell. Default 10
  (matches `AGENTIC_REF_RUNS` batch size).
- `--all-batches` — pool runs across timestamp batches naively. Default off:
  latest batch per cell only (mirrors `results:analyze --latest`). No batch fixed
  effects: no between-batch drift is expected; the flag exists because some old
  batches are stale and pending deletion, after which pooling becomes the norm.
- `--out` — output directory override. Default `agent-eval/comparisons/<slug>/`
  (gitignored) with a deterministic slug, e.g.
  `control-none_vs_do-dont+full@701+703`. Re-runs overwrite in place.

## Comparison resolution and early exit

**Usable run** = its `analysis.json` exists and parses. Runs with `result.json`
status `failed` and no analysis (sandbox/infra failures) are excluded, never counted
toward `--min-runs`, and listed in the report. Runs that passed but lack
`analysis.json` are a distinct gap type: the offline pass hasn't run.

**Gating.** Every cell in {control ∪ treatments} × selected workflows needs
≥ `--min-runs` usable runs in the selected batch(es). Any shortfall prints a gap
table (cell, have/need, reason) and **all** remediation commands at once, grouped
per case with workflows comma-joined to minimize invocations:

```
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
(`log` | `log1p` | `none`), `direction` (`lower-better` | `higher-better` |
`neutral`). Only registry metrics enter the test grid. Initial set (20):

| # | Path | Transform | Direction |
|---|------|-----------|-----------|
| 1 | `speed.durationSeconds` | log | lower-better |
| 2 | `speed.turns` | log1p | lower-better |
| 3 | `cost.estimatedCostUsd` | log | lower-better |
| 4 | `cost.inputTokens` | log | lower-better |
| 5 | `cost.outputTokens` | log | lower-better |
| 6 | `cost.cacheHitRate` | none | higher-better |
| 7 | `cost.totalToolCalls` | log1p | lower-better |
| 8 | `toolUse.buckets.docs` | log1p | neutral |
| 9 | `toolUse.buckets.exploration` | log1p | neutral |
| 10 | `toolUse.buckets.edit` | log1p | neutral |
| 11 | `toolUse.buckets.verification` | log1p | neutral |
| 12 | `churn.filesEdited` | log1p | lower-better |
| 13 | `dsCoverage.dsShareOfAllNodes` | none | higher-better |
| 14 | `dsCoverage.dsShareOfComponentNodes` | none | higher-better |
| 15 | `deltaToBaseline.complexity.cyclomatic.delta` | none | lower-better |
| 16 | `deltaToBaseline.complexity.cognitive.delta` | none | lower-better |
| 17 | `deltaToBaseline.complexity.jsxCognitive.delta` | none | lower-better |
| 18 | `deltaToBaseline.diff.sloc.added` | log1p | neutral |
| 19 | `deltaToBaseline.diff.sloc.net` | none | neutral |
| 20 | `deltaToBaseline.diff.filesChanged` | log1p | neutral |

Rationale: right-skewed positive metrics (durations, tokens, cost) get `log`;
counts that can be 0 get `log1p`; proportions and signed deltas stay untransformed.

## Statistical model

Per metric, OLS via statsmodels with `cov_type='HC3'` (small-sample-appropriate
heteroscedasticity-robust SEs; arms have visibly different variances):

- **Pairwise models**: each control-vs-treatment estimate comes from a model over
  only the control's and that treatment's rows — never a joint all-case model.
  Estimates are independent of which other cases the invocation includes.
- **Single-workflow mode**: `y ~ C(case)`, control reference; the treatment
  coefficient is the effect.
- **Aggregation mode**: headline model `y ~ C(case) + C(workflow)` (pooled average
  treatment effect with workflow scale differences absorbed), plus per-workflow
  re-fits reported as context only — not FDR-tested.
- Registry transform applied to `y`; for log/log1p metrics the report also shows
  the back-transformed effect as % change (`exp(β)−1`; for log1p metrics this is
  the % change in `1+y`, labeled as such).
- **Missing values**: rows lacking a metric's value drop from that metric's model
  only; per-metric n is reported. A metric with any arm having <2 values is
  skipped with a printed reason and excluded from the FDR family.

**FDR.** Benjamini–Hochberg at 5% (`multipletests(..., method='fdr_bh')`) across
the **full invocation grid**: every headline (metric × treatment) test of the
invocation forms one family. Rationale: the report is the unit of inference — its
whole grid is screened as one act, so the correction is scaled to it; per-treatment
families would under-correct exactly in the widest sweeps where FDR protection
matters most. A pair run alone yields its canonical, composition-independent
verdict. Each test reports β, robust SE, 95% CI, p, q, and verdict
(`significant` iff q ≤ 0.05) with direction.

## Outputs

`agent-eval/comparisons/<slug>/`:

- `manifest.json` — comparison spec (control, treatments, workflows, mode,
  min-runs, batch selection), metric registry snapshot, provenance: per-cell run
  counts, selected batch timestamps, excluded runs with reasons, absolute artifact
  paths, repo git SHA.
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
  x for log metrics, per-arm n and median in the legend, workflow name and FDR
  verdict (q, from the headline test) stamped on the figure. Workflows are never
  overlaid in one panel — their scales differ too much.

## Error handling

- Unknown case/workflow names: immediate error listing valid names.
- `uv` missing: dataset + manifest still written; exit printing the literal
  `uv run scripts/compare_stats.py <dir>` command to run elsewhere.
- Python failure: stderr surfaced, non-zero exit, dataset left for debugging.
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

## Decisions log

- Curves = distribution curves (annotated ECDFs), not forest/power plots.
- Curated metric registry, not auto-discovered leaves.
- Batches: latest per cell by default; `--all-batches` naive pooling for after
  stale data is deleted; no batch fixed effects.
- Aggregation: pooled workflow-fixed-effects headline + per-workflow context.
- Min 10 usable runs per cell, `--min-runs` override.
- Infra failures excluded entirely; pass-rate reported, not tested.
- Single control in practice: `control-none` (control-doc research abandoned).
- Pairwise models per treatment; HC3; BH family = full invocation grid.
- Python (uv + pandas/statsmodels/matplotlib) for stats/plots; TS for repo-aware
  orchestration.
