# DS coverage: instantiation-weighted counting

Status: adopted. This plan builds on `agentic-reference-ds-misuse-metric`
(#398 with #399's feedback merged in) as the next PR in that stack, at
`metricsVersion` 7, bumping to 8.

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
  The walk therefore visits every graph file and skips only the _counting_
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
  feed back (recursion counted at depth 1). Intra-SCC usage _sites_ still
  count as nodes at their owner's multiplier. Deterministic and
  order-independent.
- **Fractional weights** from conditional branches propagate multiplicatively
  into multipliers (a usage at weight 0.5 contributes 0.5 instantiations).

Instance totals are `Σ owner-bucket counts × mult(owner)`. Static totals are
the same fold with all multipliers at 1 — the two metrics share one census.

### Degradation invariant

Multiplication only happens where a usage resolves to a `local` or
`wrapped-ds` identity whose key matches an owner bucket. Everything else —
externals, unresolved tags — behaves exactly as today. The weighted metric
never reports _less_ than the static one for a component's body counted at
its declaration site — except where fractional conditional weights
propagate: a usage reached only behind a conditional carries a multiplier
below 1, so a component used at weight 0.5 legitimately halves its body's
instances below the static count (pinned by a scenario test).

A subsetting wrapper (a local component that renders a single DS component
as a restricted passthrough, see Architecture section 1) is a `local`
identity for this graph in its own right: usages of it feed its own owner
bucket exactly like any other local component, so it gets a real
usage-derived multiplier instead of flooring at 1, and any other local JSX
it renders — a slot passed as a hardcoded prop (`footer={<Footer/>}`), for
instance — inherits that multiplier rather than the floor. Statically it
still resolves straight to the DS identity it subsets, unchanged from before
this graph existed; the split is which of its two identities — the DS one
or its own local one — a given aggregate resolves it to (see Architecture
section 1, `wrapped-ds`).

### Documented limitations (not solved)

- `.map()` / list multiplicity is statically unknowable: 1 per syntactic site.
- JSX-valued constants referenced by identifier (`{icon}`) count at their
  declaration site ×1 (module bucket), not per reference.
- Render-prop JSX (`<Route element={<Page/>}/>`) counts at its syntactic
  site × the enclosing owner's multiplier, which is dynamically correct —
  including when the enclosing owner is itself a subsetting wrapper, now
  that a wrapper's own usages feed its owner bucket like any local
  component's.
- Function-scoped and object-literal member components under-attribute: a
  function-scoped component, or an object-literal member — e.g. `Plain` in
  `const AppUI = { Plain: () => <div/> }` — used N times still counts its
  body once, at the enclosing owner's multiplier, not N times. Usages
  resolve to `file#Plain` while the body buckets under `AppUI` (see
  Architecture, section 1).

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

Components declared _inside_ a function attribute to the enclosing top-level
owner: their body counts once at that owner's multiplier. Usages of such a
component still resolve to `local` (the resolver analyzes function-scope
declarations), so a function-scoped component used N times renders its body
N times dynamically but counts it once here — a documented under-attribution
alongside the `.map()` limitation. Object-literal member components
(`const AppUI = { Plain: () => <div/> }`) under-attribute the same way:
`AppUI.Plain` usages resolve to the identity `file#Plain`, but `ownerName`
roots the property's body at the enclosing top-level declaration (`AppUI`),
so `Plain`'s own multiplier never reaches where its body was counted.

Owner detection lives beside `node-path.ts`'s `declarationName()` and the two
stay deliberately distinct: paths use the _nearest_ named declaration as a
display name (a class component's path roots at `render`), owners use the
_top-level_ declaration as an identity key (the class itself, matching what
usages resolve to). A test pins the correspondence for the common case
(top-level function component: path root == owner name) so drift is visible.

The restructured walk must preserve the node-path builder's contract from
#398: `nextPath()` called exactly once per counted component element, in a
traversal order a later run reproduces. Owner bucketing changes where counts
accumulate, never the traversal.

The census maintains the static aggregates (global and per-file `NodeTotals`,
per-identity `components`) and the per-owner buckets in the same pass: each
counted element updates its owner's bucket alongside the totals, kept in
lockstep by construction and pinned by the fixtures that assert both at once.
Beside those, the census emits:

- usage edges `owner → local key` with summed weights (a byproduct of tag
  resolutions the walk already performs)
- unresolved elements, each carrying its owner

If a declaration name collides with a property-assignment name in the same
file (`const Header` + `Card.Header = …`), the buckets merge; rare and
acceptable.

#### `wrapped-ds`: subsetting wrappers resolve to two identities

Identify resolves a subsetting wrapper (a local component whose body forwards
props to a single DS root, and either no children or its own `children`
prop straight through — see `react/resolve.ts`) to a `wrapped-ds` identity,
not directly to `ds`: the wrapper's own module/name, plus the DS identity it
subsets. This is the one place static and instance aggregates read the same
resolution differently rather than sharing one fold:

- The usage edge (`owner → local key`) is recorded exactly as for `local`,
  keyed by the wrapper's own identity — so the multiplier solver sees the
  wrapper's usages and any other local JSX rooted at the same owner bucket
  (a hardcoded slot child, say) shares its real multiplier instead of
  flooring at 1.
- The static totals, per-file totals, and per-identity `components` map
  resolve `wrapped-ds` → `ds`, keyed by the DS identity — byte-identical to
  what a direct `ds` resolution produced before this identity existed.
- The per-owner bucket that feeds the instance fold (section 3) resolves the
  same element `wrapped-ds` → `local` instead, keyed by the wrapper's own
  identity: at the call site, the wrapper is counted as one of its own
  render-tree nodes, not as a second copy of the DS node its body already
  contributes (weighted) at its declaration site.

A nested chain of wrappers (a subsetting wrapper whose forwarded root is
itself another subsetting wrapper) follows through to the DS identity at the
end of the chain, so static counts read the same as if every level had
collapsed straight to `ds`, as before this identity existed.

### 2. `multipliers.ts`: shared solver (framework-agnostic, new)

Pure graph math: takes owner keys and weighted edges, returns
`Map<ownerKey, number>`. Tarjan (or equivalent) SCC condensation, then one
pass over the condensation in topological order. No framework or TS imports;
unit-testable standalone.

### 3. `index.ts`: assembly

Solves multipliers over `census.edges`, then folds `census.owners` once, at
the solved multipliers, into the `instances` block. The static numbers need
no fold of their own — they come straight off the census's own totals and
per-identity counts, computed in the same pass as the buckets (section 1) —
so only the instance side is assembled here, next to the solver. `CensusResult`
keeps its per-owner buckets (`owners`) alongside the totals. The walk stays a
single per-element pass with several consumers — totals, owner buckets, usage
edges, and #398's opt-in `nodeList` — rather than growing a fourth parallel
accumulation.

A possible future simplification: drop the census's direct total writes and
instead fold `owners` twice in `index.ts` — once at multiplier ≡ 1 for
static, once at solved multipliers for instances — the way `instances` is
already built. Not done here, to keep the walk's existing direct-total
writes (and the fixtures pinning them) untouched.

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

`NodeRecord` (from #398) stays UNWEIGHTED: `weight` keeps its exact stored
meaning (static, conditional-branch fraction) and no instance figure is added.
The node list is the ds-misuse judge's input, and the judge must see each
source element exactly once in its static identity — mixing a weighted field
into the same records invites consumers to sum them by category, which can
never reconcile with the `instances` aggregates (a wrapper call site is `ds`
statically but `local` weighted). Instance weighting is available only in the
report's `instances` block. No owner key on records: the path's first segment
covers human reading, and `instances.multipliers` in the report gives the
identity-keyed view.

## Post-analysis and consumers

- `post-analysis.ts`: coverage aggregation and deltas gain instance-share
  variants; the headline columns (μ shareAll / shareComp and their Δs) switch
  to instance-based numbers. Per-row detail tables keep both static and
  instance shares; grouped μ tables show instance-based only.
- Committed baselines invalidate through the existing `metricsVersion`
  mechanism (`agentic-reference/post-analysis.ts`): one bump, and baselines —
  including the `ds-nodes` census files from #398 — regenerate. Frozen run
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
10. Subsetting wrapper (statics resolve `ds`, unchanged): its own usages now
    feed its owner bucket like any local component, so its multiplier is
    usage-derived rather than floored at 1.
11. Loose module-level JSX: ×1.
12. Inner (function-scoped) component: body attributes to enclosing owner.
13. `export default function Page` naming: usages and owner key line up.
14. Subsetting wrapper with a local slot child hardcoded into a prop
    (`footer={<Footer/>}`): the child's multiplier equals the wrapper's, no
    longer floored at 1 alongside it (the blind spot this revision fixes).
15. A subsetting wrapper used from inside an already-multiplied caller:
    multipliers compose through the wrapped-ds edge like any other chain.

## Review against PR #398/#399

[#399](https://github.com/storybookjs/mcp/pull/399) is review feedback merged
into [#398](https://github.com/storybookjs/mcp/pull/398) (DS misuse metric,
open, based on `agentic-reference-eval`). #398 already reshapes the same
census walk: `count()` takes the element node, an opt-in `nodeList` of
`NodeRecord`s is emitted for the LLM judge, node paths root at a
nearest-declaration name, and node lists are stored as `ds-nodes` census file
baselines under `metricsVersion` 7.

Changes folded into this plan as a result: owner detection co-located with
`node-path.ts` under an explicit display-name vs identity-key distinction;
the walk restructure bound by the path builder's call-once/stable-order
contract; node records kept unweighted; `metricsVersion` as the invalidation
mechanism.

Resolved: this branch (`ds-coverage-weighted`) stacks on the misuse branch,
so the plan builds directly on #398's census shape. The bump to 8
regenerates baselines and invalidates cached judgements; mass judging is
best deferred until this lands.

Deferred follow-up (misuse metric, not this task): judgement records store
only `{path, file, line, tag}` + scores. Storing the node's `weight` (and an
instance figure computed from the owner multiplier) when zipping the model
response back to input nodes would make future instance-weighted misuse
summaries self-contained instead of requiring a re-join against the run's
node census file.
