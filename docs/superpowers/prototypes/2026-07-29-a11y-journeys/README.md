# Archived: hand-authored a11y user journeys

**Status: retired 2026-07-29. Superseded by autonomous interaction exploration.**

This is the complete, working prototype of the first approach to the accessibility
metric: Playwright driving **hand-authored user journeys**, with axe-core injected
as a standalone library and scanned at checkpoints along each journey.

It worked. It is archived rather than deleted because the measurements it produced
are the evidence base for every decision that followed, and because parts of it
carry forward.

## Why it was retired

Journeys are hand-authored and coupled to the application's DOM, so they rot when
the application changes. Worse, the measurements showed most of them earned
nothing:

- `checkout-errors` had an **identical violation set** to `checkout-empty`. Journey
  03 existed solely to submit an empty form and render validation errors, and
  produced **zero** incremental findings.
- `modal-quantity-changed` added nothing over `modal-open`.
- 2 of 8 checkpoints paid for nothing at all.
- Route coverage was only **3 of 6** declared routes, because journeys visit what
  their author thought to visit.

The replacement explores the application's interaction graph autonomously: it
enumerates routes, finds elements with interactive roles, triggers synthetic
actions, re-scans for newly-reachable elements, and scans accessibility at each
distinct state. No journey is written by hand.

## What carries forward

These are **not** retired — the replacement reuses them:

| file | why it survives |
| --- | --- |
| `harness/lib/axe.mjs` | Standalone axe-core injection: reads `axe.min.js` off disk, injects via `addInitScript`, calls `axe.run()` in-page. No `@axe-core/playwright`. |
| `harness/lib/server.mjs` | Static server bound to **IPv4 explicitly**. Vite binds `[::1]` only, so `127.0.0.1` gets ECONNREFUSED while the server is up. |
| `harness/lib/mock.mjs` | Request interception for the app's live API. Without it, violation counts depend on a third-party server. |
| `harness/make-mutant.mjs` | Injects three known defects. This is the test oracle, and the only way to verify the metric without spending on LLM runs. |
| `harness/fixtures/` | Pinned API responses. |

Retired: `harness/journeys/*`, and the journey-driving parts of `measure.mjs` /
`run-a11y.mjs`.

## Measurements (the evidence base)

Raw output in `results/`. Peak nodes per rule, across 8 checkpoints in 3 journeys.

| tree | WCAG rules/nodes | best-practice rules/nodes |
| --- | --- | --- |
| pinned ref baseline | 2 / 4 | 3 / 13 |
| real collected run | 2 / 4 | 3 / 14 |
| mutant (3 injected defects) | 4 / 17 | 3 / 13 |
| ref with corrupted binaries | 2 / 4 | 3 / 13 |

Baseline rules: `region` ×11 (best-practice), `color-contrast` ×3 (wcag2aa/143),
`meta-viewport` ×1 (wcag2aa/144), `landmark-one-main` ×1 (BP),
`page-has-heading-one` ×1 (BP).

Bit-identical across 5 repeat runs. Full pipeline 3.9–4.9s.

### Findings that must survive into any replacement

1. **A failed journey scored *better* than a clean baseline.** `results/out-mutant.json`
   records 6 rules / **14 nodes** with 2 of 3 journeys passing — a tree containing
   three injected defects scoring below the 17-node baseline, because a failed
   journey contributes zero violations. Any successor **must** gate on completion
   and emit `null`, never a reduced score.

2. **An a11y regression can destroy the thing measuring it.** Journey 03 located the
   cart via `getByRole('button', { name: 'food cart' })`. The injected `button-name`
   defect deleted that accessible name and the journey timed out. Locate
   structurally; never by an accessible name that is itself under test.

3. **Scanning only at the end of a journey misses regressions.** An earlier version
   scanned once per journey and was **completely blind** to an injected `image-alt`
   defect affecting 10 nodes, because no journey *ended* on the home page. Scan at
   every distinct state.

4. **Headless Chrome reports `prefers-color-scheme: dark`.** The app switches themes
   and the injected contrast defect scores 8.47:1 — a pass. Pin the colour scheme
   (`blink-settings=preferredColorScheme=1`) or contrast regressions vanish silently.

5. **Node counts are unstable under refactoring; rule counts are not.** The real
   collected run's only delta (`region` 13→14) was a structural re-partition:
   adding a child to `FooterCard` made axe flag `<h2>` + `<ul>` instead of one
   wrapping `<div>`. Same underlying problem, different node count.

6. **Corrupted binaries do not affect results.** `results/out-app-corrupt.json` is
   identical to the clean baseline. `image-alt` reads the attribute, not pixels;
   contrast comes from CSS.

## Also evaluated and rejected

**`accessibility-insights-scan`** (Microsoft, crawling — no journeys). Detected
**nothing** the journeys did not. Rejected because it ships a hard-coded 55-rule
allow-list containing **no best-practice rules**, has **no request interception** so
its counts depend on a live third-party API, silently missed the contrast defect
under default flags, and cost 15s plus ~1GB of dependencies against the journeys'
3.8s.

**`eslint-plugin-jsx-a11y`** (static). Caught 1 of 3 defects, and only with a
hand-maintained components map — reintroducing the DOM coupling it was meant to
remove. This app has 398 capitalised JSX tags against 4 raw `<img>` and zero raw
`<button>`, so the plugin is nearly blind to it. Over-mapping produced 10 false
positives on clean code.

## Running it (historical)

```bash
node harness/measure.mjs --project <app-tree> --ref <pinned-ref> \
  --baseline baseline-ref.json --out a11y.json
```

Requires a built app served over IPv4, and Playwright with Chromium installed.
