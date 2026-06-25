# `get-changed-stories` context-window overflow — design & experiments

Tracks the investigation behind the fix for [storybookjs/mcp#311](https://github.com/storybookjs/mcp/issues/311):
`get-changed-stories` overflowing the host tool-output token limit on large repos.

## Problem

`get-changed-stories` returns three buckets of stories from Storybook's
change-detection status store:

- **new** — story files Git sees as added,
- **modified** — the directly-changed stories (lowest import distance to the edit),
- **related/affected** — stories that only _transitively_ render a changed component.

The first two are small (a contributor touches a handful of components). The
**related** bucket explodes: when a shared primitive (Badge, Tag, Icon) changes,
every story that reaches it transitively is "affected". On real repos this hit
**1,000+ entries**:

| Project (QA campaign) | stories | `get-changed-stories` output |
| --- | --- | --- |
| Chakra UI | ~117 | **126 KB / 1,047 lines** |
| Carbon | 138 | >50 KB — **dropped the new `MetricTile` from the review** |
| Yamada UI | 205 | **157 KB** (largest seen) |

The MCP/Claude default tool-output cap is ~25k tokens. Past it, the host
**silently spills the response to a file**; the agent then head/tails the file
and self-curates. In the Carbon run that dropped the brand-new component — the
single most important thing to review — from every review collection.

## Reproduction (real token estimator, Carbon-shaped data)

1,047 related stories across 30 components, real-length import paths, scored with
the repo's own `estimateTokens`:

```
BEFORE (full dump): 177,461 chars / 60,822 est-tokens  →  OVER the 25k cap ❌
```

## Solutions explored

All measured over the same 1,047-related-story dataset (sample limit 40). Each
related story was assigned a realistic import **distance** (1 = direct importer
… 4 = deep/page-level), skewed toward transitive (6% d1, 20% d2, 40% d3, 34% d4),
matching how a shared primitive is mostly consumed indirectly.

Metrics: **tokens** (full response), **overflow** (> 25k cap), **distinctComps**
(component breadth in the sample — higher = the reviewer sees more of the spread),
**avgDist** (mean import distance of sampled stories — _lower = more likely to
actually render the change_), **d1** (number of direct importers in the sample).

| # | Strategy | tokens | overflow | sampleN | distinctComps | avgDist | d1 | Verdict |
| --- | --- | ---: | :---: | ---: | ---: | ---: | ---: | --- |
| A | **Full dump** (status quo) | 60,817 | ❌ yes | 1047 | 30 | 3.02 | 63 | Fails — the bug. |
| B | **Round-robin diversity** (v1 fix) | 2,415 | ✅ no | 40 | 30 | 2.98 | 4 | Solves overflow + max breadth, but distance-blind → picks mostly _far_, low-relevance stories. |
| C | **Distance-only** (closest 40) | 2,415 | ✅ no | 40 | 30 | 1.00 | 40 | Great relevance, but breadth is data-dependent (here 30; if d1 clusters in few components it collapses). No page-level layer. |
| D | **Distance + per-component cap (3)** | 2,418 | ✅ no | 40 | 21 | 1.00 | 40 | Cap _reduced_ breadth here; no clear win over F. |
| E | **Counts only** (no related IDs) | 362 | ✅ no | 0 | 0 | — | 0 | Smallest, but zero representative IDs → forces extra round-trips and invites ID fabrication. |
| F | **Per-component closest-first round-robin** ⭐ | 2,417 | ✅ no | 40 | **30** | **1.07** | 37 | **Winner.** Max breadth (every affected component) _and_ max relevance (closest story per component), robust regardless of distance distribution. |
| G | **Distance-stratified (band-by-band)** | 2,413 | ✅ no | 40 | 23 | 1.00 | 40 | Good relevance, lower breadth than F. |

Distance-band distribution of the sample (where each chosen story sits):

```
B round-robin     d1=4  d2=7  d3=15 d4=14   ← distance-blind: mostly far
C distance-only   d1=40 d2=0  d3=0  d4=0    ← all closest, no context layer
F percomp-closest d1=37 d2=3  d3=0  d4=0    ← closest-per-component, full breadth
```

### Why F wins

A reviewer wants, for each affected component, the one story most likely to
render the change — and to see as many affected components as fit. F delivers
exactly that: visit components in nearest-distance order and take the closest
story from each before any component gets a second slot. It matches the existing
`get-stories-by-component` distance model and the "one review collection per
distance layer" guidance already in the server instructions.

At identical token cost (~2.4k, **25× under** the pre-fix 60.8k), F moves the
sample from **avg distance 2.98 / 4 direct importers** (B) to **avg distance 1.07
/ 37 direct importers** — the related stories the reviewer actually needs.

## Implemented design (two complementary changes)

### 1. addon-mcp (this repo) — ships independently

`src/utils/serialize-changed-stories.ts` + `src/tools/get-changed-stories.ts`:

- **new + modified always listed in full** — never dropped.
- **related → strategy F sample + complete per-component breakdown**, each line
  annotated `— distance N`, breakdown annotated `nearest dN`, with an explicit
  truncation note pointing at `get-stories-by-component` for full enumeration.
- **Token-budget backstop** trims the related sample first, then (only in
  pathological direct-bucket refactors) the direct buckets — always with a note,
  never a silent drop.
- **Structured `structuredContent`** (`counts`, `relatedSample`,
  `relatedBreakdown`, `relatedTruncated`, …) for machine consumers.
- **Graceful degradation:** distance is read from `status.data.distance`. When
  absent (older Storybook), F degrades to B — still bounded and max-breadth,
  just without the closest-first relevance ranking. So the addon is correct
  today _and_ auto-upgrades the moment the build below ships.

### 2. Storybook core — the enabler (separate PR)

`code/core/src/core-server/change-detection/change-detection-service.ts`:

`buildStatuses()` _computed_ the import distance but discarded it before storing
the status. The change persists it in the already-existing `Status.data` field
(`data: { distance }`) and merges to the **nearest** distance when a story is
reachable from several changed files. This is what unlocks F's distance ranking
in the addon. Additive and backward-compatible — the manager UI ignores unknown
`data`, and `isSameStatus` already `dequal`-compares `data`.

## Verification

- **addon:** unit tests (`serialize-changed-stories.test.ts`) cover full-listing,
  related capping with truthful totals, the "never drop new/modified" Carbon
  regression, strategy-F distance ranking, round-robin fallback, breakdown
  capping, and the token-budget backstop. An end-to-end test drives the real
  tmcp MCP stack at 1,049 entries (both distance-present and distance-absent),
  asserting `< 12k` tokens.
- **core:** `change-detection-service.test.ts` asserts `data.distance` on
  modified/affected/new statuses and the nearest-distance merge.
- Carbon worst case after the fix: **60,822 → ~2.9k est-tokens**, new + modified
  intact, related total truthfully reported, 30/30 components represented.
