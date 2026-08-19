# DS Coverage Instance Weighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimate how many times each JSX element actually renders — JSX inside a reused local component counts once per instantiation of that component — and report it beside the existing static counts.

**Architecture:** The react census walk gains owner attribution (each counted element belongs to its enclosing top-level declaration) and emits per-owner buckets plus weighted `owner → local component` usage edges over the whole graph. A framework-agnostic SCC solver turns edges into instantiation multipliers; `index.ts` folds buckets × multipliers into an `instances` block on the report. Downstream, the eval's stored coverage slice, the coverage delta, and post-analysis grow instance variants, with instance shares becoming the headline grouped columns. `metricsVersion` bumps 7 → 8.

**Tech Stack:** TypeScript (strict, tab-indented), the TypeScript compiler API, vitest + memfs for fixtures. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-ds-coverage-instance-weighting-design.md`

## Global Constraints

- All commands run from `agent-eval/`: tests via `pnpm vitest run <path>`, types via `pnpm typecheck`. Both must pass before every commit.
- Static numbers are frozen: every existing assertion about `nodes`, `perFile`, `components[...].count`, shares, and node paths must keep passing with unchanged values. New fields may appear beside them.
- The node-path builder contract from #398 (comment in `react/census.ts:100`): `nextPath()` is called exactly once per counted component element, in the traversal order a later run reproduces. The walk order over counted files must not change.
- Multipliers are whole-graph: usage edges are collected from every parsed file; `isCounted` gates only which owners' counts enter totals (spec, "Semantics").
- A component with no usage sites anywhere gets multiplier 1; module buckets get 1; SCC members share the sum of edges entering the SCC (1 when none); fractional conditional weights propagate multiplicatively.
- Weights are dyadic fractions (halvings), so instance arithmetic is exact — do not round node totals; shares go through `share()` (rounds to 4).
- House style: tab indentation, comments explain _why_, commit subjects are sentence-case imperative without prefixes (match `git log`), and every commit ends with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Owner attribution (`react/owner.ts`)

**Files:**

- Create: `lib/agentic-reference/metrics/ds-coverage/react/owner.ts`
- Test: `lib/agentic-reference/metrics/ds-coverage/react/owner.test.ts`

**Interfaces:**

- Consumes: nothing project-side (only `typescript`).
- Produces: `ownerName(node: ts.Node): string | null` — identity name of the enclosing top-level statement, `null` for loose module-level JSX; `ownerKey(filePath: string, name: string | null): string` — `` `${filePath}#${name ?? '<module>'}` ``. Task 3's census keys buckets and edges with `ownerKey`.

- [ ] **Step 1: Write the failing test**

Mirror `node-path.test.ts`'s `collect` helper (same file, adjusted to return owners):

```ts
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { ownerKey, ownerName } from './owner.ts';

/** The owner name computed for every JSX element in `source`, in source order. */
function owners(source: string): Array<string | null> {
	const sourceFile = ts.createSourceFile(
		'test.tsx',
		source,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TSX,
	);
	const out: Array<string | null> = [];
	const walk = (node: ts.Node): void => {
		if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) out.push(ownerName(node));
		ts.forEachChild(node, walk);
	};
	walk(sourceFile);
	return out;
}

describe('ownerName', () => {
	it('names a function declaration', () => {
		expect(owners('function App() { return <div /> }')).toEqual(['App']);
	});

	it('names a variable declaration, and the right declarator of a list', () => {
		expect(owners('const A = () => <a />, B = () => <b />')).toEqual(['A', 'B']);
	});

	it('names a class declaration by the class, not by render', () => {
		// node-path's declarationName() roots the *path* at `render`; the owner is
		// the identity usages resolve to, which is the class itself.
		expect(owners('class Card { render() { return <div /> } }')).toEqual(['Card']);
	});

	it('names a compound-component assignment by the property', () => {
		// `Card.Header = …` is analyzed by memberOf() under the property name, so
		// usages of <Card.Header/> resolve to `Header`.
		expect(owners('Card.Header = () => <header />')).toEqual(['Header']);
	});

	it('names an anonymous default export `default`, a named one by its name', () => {
		expect(owners('export default function () { return <div /> }')).toEqual(['default']);
		expect(owners('export default function Page() { return <div /> }')).toEqual(['Page']);
		expect(owners('export default () => <div />')).toEqual(['default']);
	});

	it('attributes a nested component to the enclosing top-level declaration', () => {
		// Inner renders as part of Page, so its markup is Page's markup.
		expect(owners('const Page = () => { const Inner = () => <i />; return <div /> }')).toEqual([
			'Page',
			'Page',
		]);
	});

	it('returns null for loose module-level JSX', () => {
		expect(owners('render(<App />)')).toEqual([null]);
	});
});

describe('ownerKey', () => {
	it('formats declaration and module-bucket keys', () => {
		expect(ownerKey('src/App.tsx', 'App')).toBe('src/App.tsx#App');
		// '<' cannot appear in an identifier, so the bucket cannot collide.
		expect(ownerKey('src/main.tsx', null)).toBe('src/main.tsx#<module>');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage/react/owner.test.ts`
Expected: FAIL — cannot resolve `./owner.ts`.

- [ ] **Step 3: Implement `owner.ts`**

```ts
// Which top-level declaration owns a JSX element.
//
// Owner keys feed the instantiation-multiplier graph: every element belongs to
// the nearest enclosing *top-level* statement, named exactly the way identify
// names local identities, so a usage resolving to `local { module, name }`
// lands on the bucket of the declaration that renders it. The naming rules
// mirror module-graph.ts's recordDeclaration.
//
// This is deliberately NOT node-path.ts's declarationName(): a path roots at
// the nearest named declaration for display (`render` for a class component),
// an owner is the identity usages resolve to (the class). owner.test.ts pins
// the correspondence for the common case.
import ts from 'typescript';

/** `<file>#<name>` for a declaration's bucket, `<file>#<module>` for loose JSX. */
export function ownerKey(filePath: string, name: string | null): string {
	return `${filePath}#${name ?? '<module>'}`;
}

/**
 * The identity name of the top-level statement enclosing `node`, or null when
 * no declaration owns it (loose module-level JSX, unrecognized shapes).
 */
export function ownerName(node: ts.Node): string | null {
	let statement: ts.Node | undefined;
	for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
		if (current.parent !== undefined && ts.isSourceFile(current.parent)) {
			statement = current;
			break;
		}
	}
	if (statement === undefined) return null;

	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
		// Anonymous only as `export default …`; module-graph gives it the
		// 'default' local slot, so usages resolve to that name.
		return statement.name?.text ?? 'default';
	}

	if (ts.isVariableStatement(statement)) {
		// The declarator whose initializer holds the node names the owner, so
		// `const A = <a/>, B = <b/>` attributes each element to its own binding.
		for (const declaration of statement.declarationList.declarations) {
			if (node.pos >= declaration.pos && node.end <= declaration.end) {
				return ts.isIdentifier(declaration.name) ? declaration.name.text : null;
			}
		}
		return null;
	}

	if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
		return 'default';
	}

	if (
		ts.isExpressionStatement(statement) &&
		ts.isBinaryExpression(statement.expression) &&
		statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
		ts.isPropertyAccessExpression(statement.expression.left) &&
		ts.isIdentifier(statement.expression.left.expression) &&
		ts.isIdentifier(statement.expression.left.name)
	) {
		// `Card.Header = …`: memberOf() analyzes the right-hand side under the
		// property name, so the property name is the identity.
		return statement.expression.left.name.text;
	}

	return null;
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage/react/owner.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage/react/owner.ts lib/agentic-reference/metrics/ds-coverage/react/owner.test.ts
git commit -m "Attribute JSX elements to their owning top-level declaration"
```

---

### Task 2: Multiplier solver (`multipliers.ts`)

**Files:**

- Create: `lib/agentic-reference/metrics/ds-coverage/multipliers.ts`
- Test: `lib/agentic-reference/metrics/ds-coverage/multipliers.test.ts`

**Interfaces:**

- Consumes: nothing project-side.
- Produces: `interface UsageEdge { from: string; to: string; weight: number }` and `solveMultipliers(edges: UsageEdge[]): Map<string, number>`. The map covers every key appearing in an edge; callers treat absent keys as 1. Task 3 re-exports `UsageEdge` from `types.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { solveMultipliers } from './multipliers.ts';

describe('solveMultipliers', () => {
	it('returns an empty map for no edges', () => {
		expect(solveMultipliers([])).toEqual(new Map());
	});

	it('gives a source with no incoming edges the floor of 1', () => {
		const solved = solveMultipliers([{ from: 'page', to: 'a', weight: 2 }]);
		expect(solved.get('page')).toBe(1);
		expect(solved.get('a')).toBe(2);
	});

	it('multiplies through a chain', () => {
		const solved = solveMultipliers([
			{ from: 'page', to: 'a', weight: 2 },
			{ from: 'a', to: 'b', weight: 2 },
		]);
		expect(solved.get('b')).toBe(4);
	});

	it('sums a diamond', () => {
		const solved = solveMultipliers([
			{ from: 'page', to: 'widget', weight: 1 },
			{ from: 'page', to: 'shared', weight: 1 },
			{ from: 'widget', to: 'shared', weight: 1 },
		]);
		expect(solved.get('shared')).toBe(2);
	});

	it('propagates fractional weights', () => {
		const solved = solveMultipliers([
			{ from: 'page', to: 'a', weight: 0.5 },
			{ from: 'a', to: 'b', weight: 1 },
		]);
		expect(solved.get('a')).toBe(0.5);
		expect(solved.get('b')).toBe(0.5);
	});

	it('counts a self-recursive component by its external usage only', () => {
		const solved = solveMultipliers([
			{ from: 'page', to: 'tree', weight: 3 },
			{ from: 'tree', to: 'tree', weight: 1 },
		]);
		expect(solved.get('tree')).toBe(3);
	});

	it('shares the entering sum across a mutual-recursion cycle', () => {
		const solved = solveMultipliers([
			{ from: 'page', to: 'a', weight: 2 },
			{ from: 'a', to: 'b', weight: 1 },
			{ from: 'b', to: 'a', weight: 1 },
		]);
		// B renders whenever A does; the SCC shares what enters it.
		expect(solved.get('a')).toBe(2);
		expect(solved.get('b')).toBe(2);
	});

	it('floors an unreferenced cycle at 1', () => {
		const solved = solveMultipliers([
			{ from: 'a', to: 'b', weight: 1 },
			{ from: 'b', to: 'a', weight: 1 },
		]);
		expect(solved.get('a')).toBe(1);
		expect(solved.get('b')).toBe(1);
	});

	it('is independent of edge order', () => {
		const edges = [
			{ from: 'page', to: 'a', weight: 2 },
			{ from: 'a', to: 'b', weight: 1 },
			{ from: 'b', to: 'a', weight: 1 },
			{ from: 'page', to: 'b', weight: 5 },
		];
		const forward = solveMultipliers(edges);
		const backward = solveMultipliers([...edges].reverse());
		expect(backward).toEqual(forward);
		// Both members share the 7 entering the cycle: rough for the member the
		// entries skip, but deterministic, and cycles are rare.
		expect(forward.get('a')).toBe(7);
		expect(forward.get('b')).toBe(7);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage/multipliers.test.ts`
Expected: FAIL — cannot resolve `./multipliers.ts`.

- [ ] **Step 3: Implement `multipliers.ts`**

```ts
// Instantiation multipliers over the owner-usage graph.
//
// mult(C) = Σ over C's usage sites: site weight × mult(site's owner). A key
// nothing uses keeps the floor of 1 — today's "count once" behavior for
// pages, story-only components, and dead code alike.
//
// Cycles cannot be unrolled statically, so strongly connected components are
// condensed: every member of an SCC shares the sum of the edges entering the
// SCC from outside (1 when nothing enters), and intra-SCC edges feed nothing
// back — recursion is counted at depth 1. Sharing overstates a member the
// entries skip (see multipliers.test.ts), but it is order-independent and
// never lets `A ↔ B, page → A` zero out B, which per-member sums would.

export interface UsageEdge {
	from: string;
	to: string;
	weight: number;
}

/** Multiplier for every key appearing in an edge; absent keys mean 1. */
export function solveMultipliers(edges: UsageEdge[]): Map<string, number> {
	const outgoing = new Map<string, UsageEdge[]>();
	const nodes = new Set<string>();
	for (const edge of edges) {
		nodes.add(edge.from);
		nodes.add(edge.to);
		const from = outgoing.get(edge.from);
		if (from === undefined) outgoing.set(edge.from, [edge]);
		else from.push(edge);
	}

	// Tarjan. Recursive: the depth is the longest render chain in the app,
	// which is nowhere near stack limits.
	let index = 0;
	const indices = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const sccs: string[][] = [];
	const connect = (v: string): void => {
		indices.set(v, index);
		low.set(v, index);
		index += 1;
		stack.push(v);
		onStack.add(v);
		for (const edge of outgoing.get(v) ?? []) {
			if (!indices.has(edge.to)) {
				connect(edge.to);
				low.set(v, Math.min(low.get(v)!, low.get(edge.to)!));
			} else if (onStack.has(edge.to)) {
				low.set(v, Math.min(low.get(v)!, indices.get(edge.to)!));
			}
		}
		if (low.get(v) === indices.get(v)) {
			const scc: string[] = [];
			let member: string;
			do {
				member = stack.pop()!;
				onStack.delete(member);
				scc.push(member);
			} while (member !== v);
			sccs.push(scc);
		}
	};
	for (const node of nodes) {
		if (!indices.has(node)) connect(node);
	}

	const sccOf = new Map<string, number>();
	sccs.forEach((scc, id) => {
		for (const member of scc) sccOf.set(member, id);
	});

	// Tarjan emits an SCC only after everything reachable from it, so walking
	// the list backwards visits sources before their targets.
	const entering = new Map<number, number>();
	const multipliers = new Map<string, number>();
	for (let id = sccs.length - 1; id >= 0; id -= 1) {
		const value = entering.get(id) ?? 1;
		for (const member of sccs[id]!) {
			multipliers.set(member, value);
			for (const edge of outgoing.get(member) ?? []) {
				const target = sccOf.get(edge.to)!;
				if (target !== id) {
					entering.set(target, (entering.get(target) ?? 0) + edge.weight * value);
				}
			}
		}
	}
	return multipliers;
}
```

- [ ] **Step 4: Run tests and typecheck to verify they pass**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage/multipliers.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage/multipliers.ts lib/agentic-reference/metrics/ds-coverage/multipliers.test.ts
git commit -m "Solve instantiation multipliers over the usage graph"
```

---

### Task 3: Census owners and the report's `instances` block

**Files:**

- Modify: `lib/agentic-reference/metrics/ds-coverage/types.ts`
- Modify: `lib/agentic-reference/metrics/ds-coverage/react/census.ts`
- Modify: `lib/agentic-reference/metrics/ds-coverage/index.ts`
- Test: `lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts` (new describe + updates to existing strict assertions)

**Interfaces:**

- Consumes: `ownerKey`/`ownerName` (Task 1), `solveMultipliers`/`UsageEdge` (Task 2).
- Produces: on `DsCoverageReport`: `instances: { nodes: NodeTotals; dsShareOfAllNodes: number | null; dsShareOfComponentNodes: number | null; multipliers: Record<string, number> }`; `components` entries gain `instances: number`; `NodeRecord` and `UnresolvedElement` gain `instances: number`. Tasks 5–7 consume exactly these names.

- [ ] **Step 1: Write the failing tests**

Append to `ds-coverage.test.ts`:

```ts
describe('instance weighting', () => {
	it('counts JSX inside a reused component once per instantiation', () => {
		const report = analyze({
			'src/Button.tsx': [
				"import { DSButton } from '@ds/button'",
				'export const LocalButton = () => <div><DSButton /></div>',
			].join('\n'),
			'src/App.tsx': [
				"import { LocalButton } from './Button'",
				'export const App = () => <main><LocalButton /><LocalButton /><LocalButton /></main>',
			].join('\n'),
		});
		// Static counting is untouched: three usage sites, one body.
		expect(report.nodes).toMatchObject({ all: 6, host: 2, ds: 1, local: 3 });
		// Instances: LocalButton's body renders once per usage.
		expect(report.instances.nodes).toEqual({
			all: 10,
			host: 4,
			component: 6,
			ds: 3,
			external: 0,
			local: 3,
			unresolved: 0,
		});
		expect(report.instances.dsShareOfAllNodes).toBe(0.3);
		expect(report.instances.multipliers).toEqual({ 'src/Button.tsx#LocalButton': 3 });
		expect(report.components['@ds/button#DSButton']).toEqual({
			category: 'ds',
			count: 1,
			instances: 3,
		});
	});

	it('collects usage edges from files the census filter excludes', () => {
		vol.fromJSON(
			{
				'src/Button.tsx': [
					"import { DSButton } from '@ds/button'",
					'export const LocalButton = () => <div><DSButton /></div>',
				].join('\n'),
				'src/App.tsx': [
					"import { LocalButton } from './Button'",
					'export const App = () => <main><LocalButton /><LocalButton /><LocalButton /></main>',
				].join('\n'),
			},
			ROOT,
		);
		const report = analyzeDsCoverage({
			projectDir: ROOT,
			dsPackages: ['@ds/*'],
			censusInclude: ['src/Button.tsx'],
		});
		// Only Button.tsx is counted, but its multiplier is a whole-app fact.
		expect(report.nodes).toMatchObject({ all: 2, host: 1, ds: 1 });
		expect(report.instances.nodes).toMatchObject({ all: 6, host: 3, ds: 3 });
	});

	it('keeps the floor of 1 for components nothing uses', () => {
		const report = analyze({
			'src/Unused.tsx': [
				"import { DSButton } from '@ds/button'",
				'export const Unused = () => <DSButton />',
			].join('\n'),
		});
		expect(report.instances.nodes).toEqual(report.nodes);
		expect(report.instances.multipliers).toEqual({});
	});
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts -t 'instance weighting'`
Expected: FAIL — `report.instances` is undefined.

- [ ] **Step 3: Extend `types.ts`**

Re-export the edge type and add owner shapes. Add to `types.ts` (import `UsageEdge` from `./multipliers.ts`):

```ts
export type { UsageEdge } from './multipliers.ts';

/** Per-owner slice of the census: what one top-level declaration's JSX contributes. */
export interface OwnerBucket {
	totals: NodeTotals;
	components: Map<string, { category: 'host' | 'ds' | 'external' | 'local'; count: number }>;
}
```

`NodeRecord` gains, after `weight`:

```ts
/** weight × the owner's instantiation multiplier: estimated rendered copies. */
instances: number;
```

`UnresolvedElement` gains the same `instances: number` line. `CensusResult` becomes:

```ts
export interface CensusResult {
	totals: NodeTotals;
	perFile: Map<string, NodeTotals>;
	/** Weighted per-identity counts, keyed `<module>#<name>` (hosts by tag). */
	components: Map<string, { category: 'host' | 'ds' | 'external' | 'local'; count: number }>;
	unresolved: Array<Omit<UnresolvedElement, 'instances'> & { owner: string }>;
	/** Buckets for counted files' owners, keyed by ownerKey(). */
	owners: Map<string, OwnerBucket>;
	/** Whole-graph usage edges — counted files or not. */
	edges: UsageEdge[];
	/** Populated only when the census was asked for nodes. */
	nodeList?: Array<Omit<NodeRecord, 'instances'> & { owner: string }>;
}
```

`DsCoverageReport` gains after `dsShareOfComponentNodes`:

```ts
/**
 * The same census, weighted by estimated instantiations: JSX inside a local
 * component counts once per (statically estimated) render of it.
 */
instances: {
	nodes: NodeTotals;
	dsShareOfAllNodes: number | null;
	dsShareOfComponentNodes: number | null;
	/** Owners whose multiplier ≠ 1, keyed `<file>#<name>`, largest first. */
	multipliers: Record<string, number>;
}
```

and its `components` record type gains `instances: number`.

- [ ] **Step 4: Rework `census.ts`**

Imports: add `import { ownerKey, ownerName } from './owner.ts';` and the `OwnerBucket`/`UsageEdge` types. In `censusReactTree`, beside `unresolved`, add:

```ts
const owners = new Map<string, OwnerBucket>();
const edges: UsageEdge[] = [];
```

Replace the filter early-continue (`if (!isCounted(file.path)) { continue; }`) with:

```ts
// Filtered-out files still walk: their usage sites feed the multiplier
// graph — a component's instantiation count is a whole-app fact — while
// only counted files' elements enter any totals.
const counted = isCounted(file.path);
```

In `count`, after the non-rendering early return, compute the owner, record the edge for `local` resolutions, then gate everything else on `counted`:

```ts
const owner = ownerKey(file.path, ownerName(element));
if (resolution.category === 'local') {
	edges.push({ from: owner, to: `${resolution.module}#${resolution.name}`, weight });
}
if (!counted) return;

const bucket = owners.get(owner) ?? { totals: emptyTotals(), components: new Map() };
owners.set(owner, bucket);
```

Every place the existing code increments `totals.X` and `fileTotals.X`, also increment `bucket.totals.X`; every place it updates the file-level `components` map, update `bucket.components` the same way. The `nodeList.push` object gains `owner`, and the `unresolved.push` object gains `owner`. Return `{ totals, perFile, components, unresolved, owners, edges, nodeList: includeNodes ? nodeList : undefined }`.

`walk(file.sourceFile, 1)` now runs for every file; keep `perFile.set` guarded by `fileTotals.all > 0` (uncounted files never touch `fileTotals`, so nothing changes there). The `nextPath` builder stays created per file but is only ever invoked from the counted branch, preserving the #398 contract.

- [ ] **Step 5: Assemble in `index.ts`**

Imports: `import { solveMultipliers } from './multipliers.ts';` plus the `NodeTotals` type. Hoist to module scope:

```ts
const NODE_KEYS: Array<keyof NodeTotals> = [
	'all',
	'host',
	'component',
	'ds',
	'external',
	'local',
	'unresolved',
];
```

After the census call:

```ts
const multipliers = solveMultipliers(census.edges);
const multiplierOf = (owner: string): number => multipliers.get(owner) ?? 1;

const instanceNodes: NodeTotals = {
	all: 0,
	host: 0,
	component: 0,
	ds: 0,
	external: 0,
	local: 0,
	unresolved: 0,
};
const componentInstances = new Map<string, number>();
for (const [owner, bucket] of census.owners) {
	const factor = multiplierOf(owner);
	for (const key of NODE_KEYS) instanceNodes[key] += bucket.totals[key] * factor;
	for (const [component, entry] of bucket.components) {
		componentInstances.set(
			component,
			(componentInstances.get(component) ?? 0) + entry.count * factor,
		);
	}
}
```

`sortedComponents` takes the census and `componentInstances` and emits `{ category, count, instances }` entries (same ordering as today: by `count` descending, then key). The report gains:

```ts
		instances: {
			nodes: instanceNodes,
			dsShareOfAllNodes: share(instanceNodes.ds, instanceNodes.all),
			dsShareOfComponentNodes: share(instanceNodes.ds, instanceNodes.component),
			multipliers: Object.fromEntries(
				[...multipliers]
					.filter(([, value]) => value !== 1)
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
			),
		},
		unresolvedElements: census.unresolved.map(({ owner, ...element }) => ({
			...element,
			instances: element.weight * multiplierOf(owner),
		})),
```

and the nodeList passthrough becomes:

```ts
		...(includeNodes
			? {
					nodeList: (census.nodeList ?? []).map(({ owner, ...record }) => ({
						...record,
						instances: record.weight * multiplierOf(owner),
					})),
				}
			: {}),
```

- [ ] **Step 6: Run the metric suite; update strict assertions**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage`
The three new tests pass; existing `toEqual` assertions on `components[...]`, `nodeList` records, and `unresolvedElements` fail on the new `instances` field. Update each with the correct value — in every existing fixture each owner is used at most once from a multiplier-1 owner, so `instances` equals the existing `count`/`weight` **except** where a fixture reuses a component; recompute those by hand from the semantics (spec, "Semantics"). Do not touch any static number.

- [ ] **Step 7: Run tests and typecheck to verify everything passes**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage
git commit -m "Report instantiation-weighted coverage beside the static census"
```

---

### Task 4: Spec-conformance battery

**Files:**

- Test: `lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts` (extend the `instance weighting` describe)

**Interfaces:**

- Consumes: the public `analyzeDsCoverage` report shape from Task 3.
- Produces: nothing new — this task pins the remaining spec scenarios and fixes whatever they expose.

- [ ] **Step 1: Add the remaining scenario tests**

Each is one `it` inside `describe('instance weighting')`. Add them one at a time; when one fails, find the root cause and fix the underlying code before moving to the next — no bulk fixes, no weakened assertions without a spec-grounded reason stated in a comment.

```ts
it('composes multipliers through a chain', () => {
	const report = analyze({
		'src/B.tsx': "import { DSButton } from '@ds/button'\nexport const B = () => <DSButton />",
		'src/A.tsx': "import { B } from './B'\nexport const A = () => <section><B /><B /></section>",
		'src/Page.tsx': "import { A } from './A'\nexport const Page = () => <><A /><A /></>",
	});
	expect(report.instances.multipliers).toEqual({ 'src/B.tsx#B': 4, 'src/A.tsx#A': 2 });
	expect(report.instances.nodes.ds).toBe(4);
});

it('sums usage from several owners', () => {
	const report = analyze({
		'src/Shared.tsx':
			"import { DSButton } from '@ds/button'\nexport const Shared = () => <DSButton />",
		'src/Widget.tsx':
			"import { Shared } from './Shared'\nexport const Widget = () => <div><Shared /></div>",
		'src/Page.tsx': [
			"import { Shared } from './Shared'",
			"import { Widget } from './Widget'",
			'export const Page = () => <main><Shared /><Widget /></main>',
		].join('\n'),
	});
	expect(report.instances.multipliers).toEqual({ 'src/Shared.tsx#Shared': 2 });
	expect(report.instances.nodes.ds).toBe(2);
});

it('keeps a self-recursive component finite, counted at its external usage', () => {
	const report = analyze({
		'src/Tree.tsx': 'export const Tree = () => <li><Tree /></li>',
		'src/Page.tsx': [
			"import { Tree } from './Tree'",
			'export const Page = () => <ul><Tree /><Tree /><Tree /></ul>',
		].join('\n'),
	});
	expect(report.instances.multipliers).toEqual({ 'src/Tree.tsx#Tree': 3 });
	// Three page sites ×1 plus the recursive site ×3.
	expect(report.instances.nodes.local).toBe(6);
	expect(report.instances.nodes.host).toBe(1 + 3);
});

it('shares the entering usage across mutual recursion', () => {
	const report = analyze({
		'src/AB.tsx': [
			"import { DSButton } from '@ds/button'",
			'export const A = () => <div><B /></div>',
			'export const B = () => <span><A /><DSButton /></span>',
		].join('\n'),
		'src/Page.tsx': "import { A } from './AB'\nexport const Page = () => <><A /><A /></>",
	});
	expect(report.instances.multipliers).toEqual({ 'src/AB.tsx#A': 2, 'src/AB.tsx#B': 2 });
	expect(report.instances.nodes.ds).toBe(2);
});

it('propagates conditional halving into multipliers', () => {
	const report = analyze({
		'src/Button.tsx':
			"import { DSButton } from '@ds/button'\nexport const LocalButton = () => <DSButton />",
		'src/App.tsx': [
			"import { LocalButton } from './Button'",
			'export const App = ({ x }) => x ? <LocalButton /> : <section />',
		].join('\n'),
	});
	expect(report.instances.multipliers).toEqual({ 'src/Button.tsx#LocalButton': 0.5 });
	expect(report.instances.nodes.ds).toBe(0.5);
});

it('multiplies a compound component by its member usage', () => {
	const report = analyze({
		'src/Card.tsx': [
			"import { DSBox } from '@ds/box'",
			'export const Card = () => <div />',
			'Card.Header = () => <DSBox />',
		].join('\n'),
		'src/App.tsx': [
			"import { Card } from './Card'",
			'export const App = () => <main><Card.Header /><Card.Header /></main>',
		].join('\n'),
	});
	expect(report.instances.multipliers).toEqual({ 'src/Card.tsx#Header': 2 });
	expect(report.instances.nodes.ds).toBe(2);
	// Card itself is never rendered: its body keeps the floor of 1.
	expect(report.components['div']).toEqual({ category: 'host', count: 1, instances: 1 });
});

it('does not double-count children passed through a local component', () => {
	const report = analyze({
		'src/Card.tsx': 'export const Card = ({ children }) => <div>{children}</div>',
		'src/App.tsx': [
			"import { DSButton } from '@ds/button'",
			"import { Card } from './Card'",
			'export const App = () => <Card><DSButton /></Card>',
		].join('\n'),
	});
	// The child is App's markup, counted once; only Card's own div multiplies.
	expect(report.instances.nodes.ds).toBe(1);
});

it('leaves a subsetting wrapper exactly as the static census had it', () => {
	const report = analyze({
		'src/Branded.tsx': [
			"import { DSButton } from '@ds/button'",
			'export const Branded = (props) => <DSButton {...props} />',
		].join('\n'),
		'src/App.tsx': [
			"import { Branded } from './Branded'",
			'export const App = () => <main><Branded /><Branded /></main>',
		].join('\n'),
	});
	// Usages resolve straight to DS, so no edges target Branded: the
	// degradation invariant — weighting never reports less than static.
	expect(report.instances.nodes).toEqual(report.nodes);
	expect(report.instances.multipliers).toEqual({});
});

it('roots an entry-point render call at multiplier 1', () => {
	const report = analyze({
		'src/App.tsx': "import { DSButton } from '@ds/button'\nexport const App = () => <DSButton />",
		'src/main.tsx': "import { App } from './App'\nrender(<App />)",
	});
	// The loose <App /> sits in main.tsx's module bucket, itself a root.
	expect(report.instances.multipliers).toEqual({});
	expect(report.instances.nodes.ds).toBe(1);
});

it('multiplies through a default-exported component', () => {
	const report = analyze({
		'src/page.tsx': [
			"import { DSButton } from '@ds/button'",
			'export default function Page() { return <DSButton /> }',
		].join('\n'),
		'src/App.tsx': "import Page from './page'\nexport const App = () => <><Page /><Page /></>",
	});
	expect(report.instances.multipliers).toEqual({ 'src/page.tsx#Page': 2 });
	expect(report.instances.nodes.ds).toBe(2);
});

it('attributes a function-scoped component to its enclosing declaration', () => {
	const report = analyze({
		'src/Page.tsx': [
			"import { DSButton } from '@ds/button'",
			'export const Page = () => { const Inner = () => <DSButton />; return <div><Inner /><Inner /></div> }',
		].join('\n'),
	});
	// Inner is not a *top-level* declaration, so ownerName() cannot give it a
	// bucket of its own: DSButton is attributed to Page and counts once, at
	// Page's multiplier. The <Inner/> tags themselves still resolve normally
	// to `local` — resolveScopedName analyzes function-scope declarations
	// like any other — so they are not unresolved.
	expect(report.instances.nodes.ds).toBe(1);
	expect(report.instances.nodes.local).toBe(2);
	expect(report.instances.nodes.unresolved).toBe(0);
});
```

- [ ] **Step 2: Run the battery; fix what fails**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage -t 'instance weighting'`
Expected failures are bugs in Tasks 1–3 code; for each, find the root cause before changing anything, fix, and re-run.

- [ ] **Step 3: Full metric suite and typecheck**

Run: `pnpm vitest run lib/agentic-reference/metrics/ds-coverage && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage
git commit -m "Pin the instance-weighting semantics with spec scenarios"
```

---

### Task 5: Eval slice and delta (`metrics/coverage.ts`)

**Files:**

- Modify: `lib/agentic-reference/metrics/coverage.ts`
- Test: create `lib/agentic-reference/metrics/coverage.test.ts`

**Interfaces:**

- Consumes: `report.instances` from Task 3.
- Produces: `DsCoverage.instances?: { nodes: NodeTotals; dsShareOfAllNodes: number | null; dsShareOfComponentNodes: number | null }` (optional: old stored slices lack it); `CoverageDelta.instances: { nodes: Record<keyof NodeTotals, CoverageSpan>; dsShareOfAllNodes: CoverageShareSpan; dsShareOfComponentNodes: CoverageShareSpan } | null` (null when either side predates instances). Task 6 reads exactly these paths.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { coverageDelta, isDsCoverage } from './coverage.ts';

import type { DsCoverage } from './coverage.ts';

function slice(ds: number, instanceDs: number | null): DsCoverage {
	const nodes = { all: 10, host: 4, component: 6, ds, external: 0, local: 6 - ds, unresolved: 0 };
	return {
		dsPackages: ['@ds/*'],
		files: 2,
		nodes,
		dsShareOfAllNodes: ds / 10,
		dsShareOfComponentNodes: ds / 6,
		parseFailures: [],
		readFailures: [],
		...(instanceDs === null
			? {}
			: {
					instances: {
						nodes: { ...nodes, ds: instanceDs, all: 20 },
						dsShareOfAllNodes: instanceDs / 20,
						dsShareOfComponentNodes: instanceDs / 6,
					},
				}),
	};
}

describe('coverageDelta instances', () => {
	it('spans instance totals and shares when both sides carry them', () => {
		const delta = coverageDelta(slice(2, 4), slice(3, 8));
		expect(delta.instances?.nodes.ds).toEqual({ before: 4, after: 8, delta: 4 });
		expect(delta.instances?.dsShareOfAllNodes).toEqual({ before: 0.2, after: 0.4, delta: 0.2 });
	});

	it('is null when either side predates instance measurement', () => {
		expect(coverageDelta(slice(2, null), slice(3, 8)).instances).toBeNull();
		expect(coverageDelta(slice(2, 4), slice(3, null)).instances).toBeNull();
	});

	it('accepts a stored slice without instances', () => {
		expect(isDsCoverage(slice(2, null))).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run lib/agentic-reference/metrics/coverage.test.ts`
Expected: FAIL — `instances` missing from `CoverageDelta` type / undefined at runtime.

- [ ] **Step 3: Implement**

In `coverage.ts`: add to `DsCoverage` (after `dsShareOfComponentNodes`):

```ts
	/**
	 * Instantiation-weighted totals and shares, absent on slices stored before
	 * metricsVersion 8. The multipliers stay in the full report only.
	 */
	instances?: {
		nodes: NodeTotals;
		dsShareOfAllNodes: number | null;
		dsShareOfComponentNodes: number | null;
	};
```

`measureDsCoverage` copies it from the report:

```ts
		instances: {
			nodes: report.instances.nodes,
			dsShareOfAllNodes: report.instances.dsShareOfAllNodes,
			dsShareOfComponentNodes: report.instances.dsShareOfComponentNodes,
		},
```

`CoverageDelta` gains:

```ts
	/** Instance spans, or null when either side predates instance measurement. */
	instances: {
		nodes: Record<keyof NodeTotals, CoverageSpan>;
		dsShareOfAllNodes: CoverageShareSpan;
		dsShareOfComponentNodes: CoverageShareSpan;
	} | null;
```

In `coverageDelta`, add beside the existing helpers (which stay untouched for the static fields):

```ts
const instanceSpan = (key: keyof NodeTotals): CoverageSpan => ({
	before: before.instances!.nodes[key],
	after: after.instances!.nodes[key],
	delta: after.instances!.nodes[key] - before.instances!.nodes[key],
});
const instanceShareSpan = (
	read: (instances: NonNullable<DsCoverage['instances']>) => number | null,
): CoverageShareSpan => {
	const left = read(before.instances!);
	const right = read(after.instances!);
	return {
		before: left,
		after: right,
		delta: left === null || right === null ? null : round(right - left, SHARE_DIGITS),
	};
};
```

and to the returned object:

```ts
		instances:
			before.instances === undefined || after.instances === undefined
				? null
				: {
						nodes: Object.fromEntries(NODE_KEYS.map((key) => [key, instanceSpan(key)])) as Record<
							keyof NodeTotals,
							CoverageSpan
						>,
						dsShareOfAllNodes: instanceShareSpan((entry) => entry.dsShareOfAllNodes),
						dsShareOfComponentNodes: instanceShareSpan((entry) => entry.dsShareOfComponentNodes),
					},
```

Keep `isDsCoverage` as is — `instances` is optional and needs no guard change.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run lib/agentic-reference/metrics/coverage.test.ts && pnpm typecheck && pnpm vitest run lib`
Expected: PASS. Post-analysis integration tests that build real deltas may now see `instances` appear; fix only assertions that are strict-equal on whole delta objects, adding the new field with its true values.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/coverage.ts lib/agentic-reference/metrics/coverage.test.ts
git commit -m "Carry instance coverage through the stored slice and its delta"
```

(Include `lib/agentic-reference/post-analysis.test.ts` in the add only if Step 4 required updates there.)

---

### Task 6: Post-analysis wiring and metricsVersion 8

**Files:**

- Modify: `lib/agentic-reference/post-analysis.ts`
- Test: `lib/agentic-reference/post-analysis.test.ts`

**Interfaces:**

- Consumes: `coverageOf(row)?.instances`, `deltaOf(row).coverageDelta?.instances` (Task 5 shapes).
- Produces: grouped-summary fields `dsShareOfAllInstances`, `dsShareOfComponentInstances`, `dsShareOfAllInstancesDelta`, `dsShareOfComponentInstancesDelta` (each `{ mean: number | null }`), per-run coverage columns `iShareAll`/`iShareComp`/`iShareAllΔ`/`iShareCompΔ`, and grouped `'μ shareAll'`/`'μ shareComp'`/`'μ shareAllΔ'`/`'μ shareCompΔ'` now sourced from instance means. `metricsVersion: 8`.

- [ ] **Step 1: Extend the fixture and write the failing tests**

In `post-analysis.test.ts`, extend `coverageRows()`: `coverage(ds, component, all)` gains

```ts
			instances: {
				nodes: {
					all,
					host: all - component - 2,
					component: component + 2,
					ds: ds + 2,
					external: 0,
					local: component - ds,
					unresolved: 0,
				},
				dsShareOfAllNodes: (ds + 2) / all,
				dsShareOfComponentNodes: (ds + 2) / (component + 2),
			},
```

and `row(...)`'s `coverageDelta` gains

```ts
					instances: {
						nodes: { ds: { before: dsBefore + 1, after: ds + 2, delta: ds + 1 - dsBefore } },
						dsShareOfAllNodes: {
							before: (dsBefore + 1) / all,
							after: (ds + 2) / all,
							delta: (ds + 1 - dsBefore) / all,
						},
						dsShareOfComponentNodes: {
							before: (dsBefore + 1) / (component + 2),
							after: (ds + 2) / (component + 2),
							delta: (ds + 1 - dsBefore) / (component + 2),
						},
					},
```

Update/extend the coverage tests (row 1 has ds 6, component 8, all 20, dsBefore 4; row 2 has ds 10, component 12, all 20, dsBefore 4):

1. `'prints a per-run coverage table with absolutes beside the delta'` — the `toEqual` object gains `iShareAll: '40%'`, `iShareComp: '80%'`, `iShareAllΔ: '+15%'`, `iShareCompΔ: '+30%'`.
2. `'prints a grouped coverage table with the family means'` — `'μ shareAll'` becomes `'50%'`, `'μ shareComp'` becomes `'82.86%'`, `'μ shareAllΔ'` becomes `'+25%'`, `'μ shareCompΔ'` becomes `'+40%'` (headline switched to instance means).
3. `'returns the coverage means in the stored rows'` — the `toMatchObject` gains `dsShareOfAllInstances: { mean: 0.5 }`, `dsShareOfComponentInstances: { mean: 0.8286 }`, `dsShareOfAllInstancesDelta: { mean: 0.25 }`, `dsShareOfComponentInstancesDelta: { mean: 0.4 }`.
4. New test — old runs stay readable:

```ts
// A run measured before metricsVersion 8 has no instance block anywhere;
// the columns say null rather than crashing or dragging a mean.
it('tolerates runs measured before instance weighting', () => {
	const legacy = coverageRows().map((row) => {
		const coverage = { ...(row.dsCoverage as Record<string, unknown>) };
		delete coverage.instances;
		const delta = {
			...(row.deltaToBaseline as { coverageDelta: Record<string, unknown> }).coverageDelta,
		};
		delete delta.instances;
		return { ...row, dsCoverage: coverage, deltaToBaseline: { coverageDelta: delta } };
	});
	const [, , perRun, grouped] = tables(legacy);
	expect(perRun?.[0]).toMatchObject({ iShareAll: 'null', iShareAllΔ: 'null' });
	expect(grouped?.[0]).toMatchObject({ 'μ shareAll': 'null' });
});
```

- [ ] **Step 2: Run to verify the changed tests fail**

Run: `pnpm vitest run lib/agentic-reference/post-analysis.test.ts`
Expected: the touched/added coverage tests FAIL (missing columns/fields).

- [ ] **Step 3: Implement in `post-analysis.ts`**

In `makeGeneralSummary`, beside the existing `dsShareOfAll…` reads:

```ts
const dsShareOfAllInstances = numbersAt(
	group,
	(row) => coverageOf(row)?.instances?.dsShareOfAllNodes,
);
const dsShareOfComponentInstances = numbersAt(
	group,
	(row) => coverageOf(row)?.instances?.dsShareOfComponentNodes,
);
const dsShareOfAllInstancesDelta = numbersAt(
	group,
	(row) => deltaOf(row).coverageDelta?.instances?.dsShareOfAllNodes.delta,
);
const dsShareOfComponentInstancesDelta = numbersAt(
	group,
	(row) => deltaOf(row).coverageDelta?.instances?.dsShareOfComponentNodes.delta,
);
```

and in the returned group object, after the static share fields:

```ts
			dsShareOfAllInstances: { mean: round(mean(dsShareOfAllInstances), 4) },
			dsShareOfComponentInstances: { mean: round(mean(dsShareOfComponentInstances), 4) },
			dsShareOfAllInstancesDelta: { mean: round(mean(dsShareOfAllInstancesDelta), 4) },
			dsShareOfComponentInstancesDelta: {
				mean: round(mean(dsShareOfComponentInstancesDelta), 4),
			},
```

(`deltaOf`'s local view of `coverageDelta` is typed inline where it is read — extend that inline type with `instances` the same way the static share fields are declared there. `coverageOf` already returns `DsCoverage`, which carries `instances` from Task 5.)

In `summarize`'s per-run coverage table, after `shareComp`:

```ts
					iShareAll: percent(coverage?.instances?.dsShareOfAllNodes),
					iShareComp: percent(coverage?.instances?.dsShareOfComponentNodes),
```

and after `shareCompΔ`:

```ts
					iShareAllΔ: percentDelta(delta?.instances?.dsShareOfAllNodes.delta),
					iShareCompΔ: percentDelta(delta?.instances?.dsShareOfComponentNodes.delta),
```

In the grouped coverage table, switch the four headline columns to the instance means (`'μ shareAll'` ← `group.dsShareOfAllInstances`, `'μ shareComp'` ← `group.dsShareOfComponentInstances`, `'μ shareAllΔ'` ← `group.dsShareOfAllInstancesDelta`, `'μ shareCompΔ'` ← `group.dsShareOfComponentInstancesDelta`), with a comment:

```ts
// Headline shares are instance-weighted from metricsVersion 8 on;
// the per-run table above keeps the static shares beside them.
```

Bump the version block: add the changelog line

```ts
 * - 8 weighted the census by estimated instantiations (instances), headline shares included
```

and set `metricsVersion: 8`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run lib/agentic-reference/post-analysis.test.ts && pnpm vitest run lib && pnpm typecheck`
Expected: PASS. If anything hardcodes version 7, find it with `grep -rn "metricsVersion" lib | grep 7` and update to 8 only where it means "the current version".

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/post-analysis.ts lib/agentic-reference/post-analysis.test.ts
git commit -m "Make instance shares the headline coverage numbers and bump metricsVersion to 8"
```

---

### Task 7: The human-facing script

**Files:**

- Modify: `scripts/ds-coverage.ts`

**Interfaces:**

- Consumes: `report.instances` (Task 3).
- Produces: nothing programmatic — console output only.

- [ ] **Step 1: Extend the output**

After the two existing share lines, add:

```ts
console.log(`  … of all, instance-weighted:        ${report.instances.dsShareOfAllNodes}`);
console.log(`  … of components, instance-weighted: ${report.instances.dsShareOfComponentNodes}`);

const multiplied = Object.entries(report.instances.multipliers);
if (multiplied.length > 0) {
	console.log(
		`\nInstantiation multipliers ≠ 1 (top ${Math.min(top, multiplied.length)} of ${multiplied.length}):`,
	);
	console.table(Object.fromEntries(multiplied.slice(0, top)));
}
```

The top-components table already prints `instances` automatically (`console.table` renders every field of the entries), so it needs no change.

- [ ] **Step 2: Verify by hand against a scratch tree**

```bash
mkdir -p "$SCRATCHPAD/ds-check/src"
printf 'import { DSButton } from "@ds/button"\nexport const LocalButton = () => <div><DSButton /></div>\n' > "$SCRATCHPAD/ds-check/src/Button.tsx"
printf 'import { LocalButton } from "./Button"\nexport const App = () => <main><LocalButton /><LocalButton /><LocalButton /></main>\n' > "$SCRATCHPAD/ds-check/src/App.tsx"
pnpm exec node scripts/ds-coverage.ts "$SCRATCHPAD/ds-check" --ds '@ds/*'
```

(`$SCRATCHPAD` = the session scratchpad directory.) Expected: static shares as before, the two instance lines print `0.3` and `0.5`, and the multipliers table shows `src/Button.tsx#LocalButton: 3`.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add scripts/ds-coverage.ts
git commit -m "Print instance shares and multipliers in the coverage script"
```

---

### Task 8: README note and baseline regeneration

**Files:**

- Modify: `README.md` (the `ds-coverage` metric paragraph around line 152)
- Modify (regenerated): `baselines/**` including `baselines/ds-nodes/**`

**Interfaces:**

- Consumes: everything landed above.
- Produces: committed baselines at `metricsVersion` 8.

- [ ] **Step 1: Document the metric**

In the README paragraph that starts "`ds-coverage` measures how _much_ of a run's UI comes from the design system.", add after the existing description:

```markdown
Each report also carries an instance-weighted view (`instances`): JSX inside a
reused local component counts once per estimated instantiation, so a
`LocalButton` used 100 times contributes its internal `DSButton` 100 times.
Multipliers come from a whole-graph usage census (recursion counted at depth
1, unused components floored at 1); the grouped summary tables report the
instance-weighted shares, the per-run tables show both. Static counts are
unchanged and stay in every report. Known blind spots, by design: list
multiplicity (`.map()`) and JSX-valued constants referenced as `{icon}` are
counted at their syntactic site.
```

- [ ] **Step 2: Regenerate the committed baselines**

Run: `pnpm results:analyze --recompute`
This rebuilds every committed baseline and `ds-nodes` sidecar at metricsVersion 8 (records gain `instances`). It needs the pinned mealdrop trees; if the environment cannot fetch them (network-restricted sandbox), STOP, leave this step unchecked, and report to the user that regeneration must run on their machine — do not hand-edit baseline JSON.

- [ ] **Step 3: Inspect and commit**

Check `git diff --stat baselines` — every touched baseline should show `metricsVersion: 8` and sidecar records the new field; static numbers inside must be unchanged (spot-check one file).

```bash
git add README.md baselines
git commit -m "Regenerate baselines under instance-weighted coverage"
```

---

## Verification (whole plan)

- `pnpm vitest run` — full agent-eval suite green (was 793 passing before Task 1; ends higher).
- `pnpm typecheck` — clean.
- Static-freeze audit: `git diff` over the branch must show no change to any existing static expectation value in tests.
- The spec's degradation invariant, checked once more by eye: every code path that multiplies goes through `multiplierOf`, whose default is 1, so results fall below static only where a fractional conditional weight legitimately propagates a multiplier below 1 — never otherwise.
