# DS coverage: instantiation-weighted counting

Status: revised after reviewing PR #398/#399 (see final section).

## Problem

The census counts every JSX element once, at its syntactic site. JSX inside
a reused local component is therefore counted once no matter how often the
component is instantiated: if `LocalButton` renders `<DSButton/>` and is used
100 times, today's report shows 100 `local` nodes and 1 `ds` node. A dynamic
analysis (the React devtools render tree) would show ~100 of each. The metric
under-credits (or under-debits) everything hidden behind local composition.

## Semantics: the instance model

The new numbers estimate the **render tree**, devtools-style: every element
instance counts, including local component nodes themselves. (The alternative
— dissolving locals as transparent abstraction — stays derivable as
`ds / (all − local)`; we do not implement it.)

Each owner (see Architecture) gets an **instantiation multiplier**:

- `mult(C) = Σ over usage sites u of C: weight(u) × mult(owner(u))`
- Usage edges and multipliers are computed over the **whole graph** (every
  parsed file), regardless of census filters; `isCounted` gates only which
  owners' counts enter totals. A component's instantiation count is a
  whole-app fact — the misuse judge's touched-files census
  (`censusInclude: patch.files`, #398) must still see whole-app instances.
  The walk therefore visits every graph file and skips only the *counting*
  in filtered-out ones. (Stories/tests stay excluded at the module-graph
  level, as today.)
- A local component with **no usage sites anywhere in the graph** gets
  `mult = 1`. This is
  the floor at today's behavior: pages/layouts (rendered by routers, never
  used in JSX), story-only components, and dead code all keep counting once.
- The **module bucket** (loose JSX not enclosed by any top-level component
  declaration) has `mult = 1`.
- **Cycles**: condense strongly connected components. A node in an SCC takes
  its multiplier from edges entering the SCC only; intra-SCC edges do not
  feed back (recursion counted at depth 1). Intra-SCC usage *sites* still
  count as nodes at their owner's multiplier. Deterministic and
  order-independent.
- **Fractional weights** from conditional branches propagate multiplicatively
  into multipliers (a usage at weight 0.5 contributes 0.5 instantiations).

Instance totals are `Σ owner-bucket counts × mult(owner)`. Static totals are
the same fold with all multipliers at 1 — the two metrics share one census.

### Degradation invariant

Multiplication only happens where a usage resolves to a `local` identity whose
key matches an owner bucket. Everything else — subsetting wrappers already
collapsed to `ds` by identify, externals, unresolved tags — behaves exactly as
today. The weighted metric can never report *less* than the static one for a
component's body counted at its declaration site.

### Documented limitations (not solved)

- `.map()` / list multiplicity is statically unknowable: 1 per syntactic site.
- JSX-valued constants referenced by identifier (`{icon}`) count at their
  declaration site ×1 (module bucket), not per reference.
- Render-prop JSX (`<Route element={<Page/>}/>`) counts at its syntactic
  site × the enclosing owner's multiplier, which is dynamically correct.

## Architecture

Three pieces; the walk stays single-pass.

### 1. `react/census.ts`: per-owner buckets (react-specific)

The walk gains owner attribution: each counted element belongs to the nearest
enclosing **top-level** declaration, keyed to match what identify resolves
usages to (`<declaring file path>#<name>`):

- `function Name() {}` → `Name`
- `const Name = …` (each declarator of a variable statement) → `Name`
- `class Name {}` → `Name`
- `X.Y = expr` property-assignment statements → `Y` (matches `memberOf`,
  which analyzes the assigned expression under the property name)
- `export default …` → whatever name identify's export resolution uses
  (pinned by a test)
- anything else (top-level JSX expressions, IIFEs) → the module bucket

Components declared *inside* a function attribute to the enclosing top-level
owner — dynamically correct, since they render as part of it.

Owner detection lives beside `node-path.ts`'s `declarationName()` and the two
stay deliberately distinct: paths use the *nearest* named declaration as a
display name (a class component's path roots at `render`), owners use the
*top-level* declaration as an identity key (the class itself, matching what
usages resolve to). A test pins the correspondence for the common case
(top-level function component: path root == owner name) so drift is visible.

The restructured walk must preserve the node-path builder's contract from
#398: `nextPath()` called exactly once per counted component element, in a
traversal order a later run reproduces. Owner bucketing changes where counts
accumulate, never the traversal.

The census emits raw per-owner data instead of global totals:

- per-owner `NodeTotals` and per-owner per-identity counts
- usage edges `owner → local key` with summed weights (a byproduct of tag
  resolutions the walk already performs)
- unresolved elements, each carrying its owner

If a declaration name collides with a property-assignment name in the same
file (`const Header` + `Card.Header = …`), the buckets merge; rare and
acceptable.

### 2. `multipliers.ts`: shared solver (framework-agnostic, new)

Pure graph math: takes owner keys and weighted edges, returns
`Map<ownerKey, number>`. Tarjan (or equivalent) SCC condensation, then one
pass over the condensation in topological order. No framework or TS imports;
unit-testable standalone.

### 3. `index.ts`: assembly

Folds the owner data twice — once with multipliers ≡ 1 (static, must
reproduce today's numbers exactly) and once with solved multipliers
(instances) — and assembles the report. `CensusResult` changes shape to the
per-owner form; the fold lives in shared code next to the solver. The walk
becomes a single per-element pass with several consumers — totals/owner
buckets, usage edges, and #398's opt-in `nodeList` — rather than growing a
fourth parallel accumulation.

## Report schema

All existing fields keep their exact meaning (static). Additions:

```ts
instances: {
  nodes: NodeTotals;
  dsShareOfAllNodes: number | null;
  dsShareOfComponentNodes: number | null;
  /** Local components whose multiplier ≠ 1, for debuggability. */
  multipliers: Record<string, number>;
};
// per-component attribution gains the weighted count:
components: Record<string, { category: …; count: number; instances: number }>;
// unresolved elements gain their weighted impact:
unresolvedElements: Array<{ …; instances: number }>;
```

`perFile` stays static-only (it describes syntactic content; YAGNI on a
weighted variant).

`NodeRecord` (from #398) gains `instances: number` next to `weight`. `weight`
keeps its exact stored meaning (static, conditional-branch fraction);
`instances` is `weight × mult(owner)`. No owner key on records: the path's
first segment covers human reading, and `instances.multipliers` in the report
gives the identity-keyed view.

## Post-analysis and consumers

- `post-analysis.ts`: coverage aggregation and deltas gain instance-share
  variants; the headline columns (μ shareAll / shareComp and their Δs) switch
  to instance-based numbers. Per-row detail tables keep both static and
  instance shares; grouped μ tables show instance-based only.
- Committed baselines invalidate through the existing `metricsVersion`
  mechanism (`agentic-reference/post-analysis.ts`): one bump, and baselines —
  including the `ds-nodes` sidecars from #398 — regenerate. Frozen run
  artifacts cannot regenerate, so post-analysis still null-tolerates missing
  `instances` fields on old runs.
- A `metricsVersion` bump also invalidates every cached ds-misuse judgement
  (staleness is version equality), i.e. bumps cost LLM re-judging. See the
  sequencing note in the final section.
- `scripts/ds-coverage.ts` prints both static and instance shares.

## Testing

Existing fixtures must pass unchanged (static behavior is frozen).
`multipliers.ts` gets standalone graph tests. New fixture tests:

1. Chain: page uses A ×3, A renders DS ×1 → ds instances 3.
2. Depth: page ×2 → A, A ×2 → B, B → DS → ds instances 4 (composition).
3. Diamond: two owners use the same component; multipliers sum.
4. Self-recursion (`Tree` renders `Tree`): finite, depth-1.
5. Mutual recursion (A↔B) with one external entry: SCC shares the entry
   multiplier; deterministic regardless of file order.
6. Conditional usage at weight 0.5 → multiplier 0.5 propagates.
7. Unused component floor: mult 1 (today's numbers).
8. Compound component: `Card.Header = Header`; `<Card.Header/>` usages
   multiply `Header`'s body.
9. Children passthrough: `<LocalCard><DSButton/></LocalCard>` does not
   double-count the child.
10. Subsetting wrapper (usages resolve `ds`): counts unchanged vs today.
11. Loose module-level JSX: ×1.
12. Inner (function-scoped) component: body attributes to enclosing owner.
13. `export default function Page` naming: usages and owner key line up.

## Review against PR #398/#399

[#399](https://github.com/storybookjs/mcp/pull/399) is review feedback merged
into [#398](https://github.com/storybookjs/mcp/pull/398) (DS misuse metric,
open, based on `agentic-reference-eval`). #398 already reshapes the same
census walk: `count()` takes the element node, an opt-in `nodeList` of
`NodeRecord`s is emitted for the LLM judge, node paths root at a
nearest-declaration name, and node lists are stored as `ds-nodes` sidecar
baselines under `metricsVersion` 7.

Changes folded into this plan as a result: owner detection co-located with
`node-path.ts` under an explicit display-name vs identity-key distinction;
the walk restructure bound by the path builder's call-once/stable-order
contract; `NodeRecord.instances`; `metricsVersion` as the invalidation
mechanism.

Recommended for #398 itself (open, so cheap to change there):

1. Store the node's `weight` (and, once it exists, `instances`) on judgement
   records when zipping the model response back to input nodes. Today a
   judgement stores only `{path, file, line, tag}` + scores, so any future
   instance-weighted summary needs a re-join against the run's node list;
   carrying the number makes re-summarising self-contained. The judge means
   in `score.ts` stay unweighted for now — that is a scoring decision to
   revisit once instances exist, not a schema blocker.

2. Sequencing to avoid paying twice: each `metricsVersion` bump regenerates
   committed baselines *and* invalidates all cached judgements. #398 bumps
   6→7; instance weighting bumps again. Either land weighting into the #398
   stack so one bump and one regenerate/re-judge cycle covers both, or accept
   the second bump and hold off mass judging until weighting lands. Merging
   #398 first and implementing on top avoids the census.ts conflict either
   way — this plan builds on #398's census shape.
