# DS Misuse Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ds-misuse` metric — an LLM judge that scores the design-system decisions an agentic-reference run made, from the JSX nodes it introduced.

**Architecture:** The existing `ds-coverage` census gains an opt-in per-node list addressed by AST path. Baselines are re-keyed on the external-repo pin (dropping unused per-eval duplication) and gain a pin-keyed node sidecar. A standalone CLI diffs the run against its baseline, assembles a context package (Droppy MDX + node lists + git diff), and makes one Anthropic Messages API call per run with structured output. `results:analyze` reads the resulting artifact and renders a `--misuse` table family.

**Tech Stack:** TypeScript (Node, `.ts` run directly), vitest + memfs, `typescript` compiler API, `@anthropic-ai/sdk`, picomatch.

**Spec:** `docs/superpowers/specs/2026-08-14-ds-misuse-metric-design.md`

**Working directory:** all paths below are relative to `agent-eval/` unless stated otherwise. Run commands from `agent-eval/`.

---

## File Structure

**Phase A — node census (`ds-coverage`)**

| File | Responsibility |
|---|---|
| `lib/agentic-reference/metrics/ds-coverage/types.ts` (modify) | `NodeRecord` type, `includeNodes` option, `nodes` on report + census result |
| `lib/agentic-reference/metrics/ds-coverage/react/node-path.ts` (create) | AST path construction — the only file that knows the path format |
| `lib/agentic-reference/metrics/ds-coverage/react/node-path.test.ts` (create) | Path format tests |
| `lib/agentic-reference/metrics/ds-coverage/react/census.ts` (modify) | Emit `NodeRecord`s when asked |
| `lib/agentic-reference/metrics/ds-coverage/index.ts` (modify) | Thread `includeNodes` through |
| `lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts` (modify) | Default-off shape guarantee, end-to-end node emission |
| `scripts/ds-coverage.ts` (modify) | `--nodes` flag |

**Phase B — baseline re-key + sidecar**

| File | Responsibility |
|---|---|
| `lib/post-analysis/types.ts` (modify) | Drop `evalName`/`fixtureDir` from `BaselineContext` |
| `lib/post-analysis/baseline.ts` (modify) | Key on pin; write the node sidecar |
| `lib/post-analysis/baseline.test.ts` (modify) | New key shape, sidecar round-trip |
| `lib/agentic-reference/post-analysis.ts` (modify) | `metricsVersion` 7 |
| `scripts/analyze-results.ts` (modify) | Drop the dropped baseline options |
| `baselines/**` (move/delete) | Re-keyed committed files |

**Phase C–E — the metric**

| File | Responsibility |
|---|---|
| `lib/agentic-reference/metrics/ds-misuse/types.ts` (create) | `DsMisuseReport`, `JudgedNode`, the JSON schema |
| `lib/agentic-reference/metrics/ds-misuse/tree-patch.ts` (create) | `git diff --no-index` → workspace-relative, filtered, capped |
| `lib/agentic-reference/metrics/ds-misuse/ds-docs.ts` (create) | Pinned Droppy ref + MDX collection |
| `lib/agentic-reference/metrics/ds-misuse/prompt.md` (create) | The judge prompt |
| `lib/agentic-reference/metrics/ds-misuse/context.ts` (create) | Context package assembly + cache breakpoint placement |
| `lib/agentic-reference/metrics/ds-misuse/judge.ts` (create) | The Anthropic SDK call |
| `lib/agentic-reference/metrics/ds-misuse/score.ts` (create) | Summary arithmetic |
| `lib/agentic-reference/metrics/ds-misuse/index.ts` (create) | Orchestration; artifact read/write + staleness |
| `scripts/judge-ds-misuse.ts` (create) | CLI entry point, abort paths |

**Phase F — reporting**

| File | Responsibility |
|---|---|
| `scripts/analyze-results.ts` (modify) | `--misuse` section, post-cache merge, red warning |
| `lib/post-analysis/types.ts` (modify) | `SummarizeOptions.misuse` |
| `lib/agentic-reference/post-analysis.ts` (modify) | Misuse tables + grouped means |

---

## Phase A — Node census

### Task 1: `NodeRecord` type and the `includeNodes` option

**Files:**
- Modify: `lib/agentic-reference/metrics/ds-coverage/types.ts`
- Modify: `lib/agentic-reference/metrics/ds-coverage/index.ts:43-80`
- Test: `lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `ds-coverage.test.ts`:

```ts
describe('includeNodes', () => {
	const FILES = {
		'src/App.tsx': [
			"import { Button } from '@ds/react'",
			'export const App = () => <div><Button /></div>',
		].join('\n'),
	};

	// Default-off is load-bearing: measureDsCoverage stores this report shape in
	// every committed baseline, and a new key would change every one of them.
	it('omits the nodes key entirely when not asked', () => {
		vol.fromJSON(FILES, ROOT);
		const report = analyzeDsCoverage({ projectDir: ROOT, dsPackages: ['@ds/*'] });
		expect('nodes' in report).toBe(false);
	});

	it('emits one record per counted component element when asked', () => {
		vol.fromJSON(FILES, ROOT);
		const report = analyzeDsCoverage({
			projectDir: ROOT,
			dsPackages: ['@ds/*'],
			includeNodes: true,
		});
		expect(report.nodes).toEqual([
			{
				path: 'App/Button[0]',
				file: 'src/App.tsx',
				line: 2,
				tag: 'Button',
				category: 'ds',
				module: '@ds/react',
				name: 'Button',
				weight: 1,
				props: [],
			},
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts -t includeNodes`
Expected: FAIL — `report.nodes` is `undefined`; TypeScript reports `includeNodes` is not in `DsCoverageOptions`.

- [ ] **Step 3: Add the types**

In `types.ts`, after the `UnresolvedElement` interface:

```ts
/**
 * One counted component element, addressed by a path that survives relocation.
 *
 * `path` is the enclosing declaration's name followed by the JSX ancestor chain,
 * each segment `Tag[i]` where `i` indexes element siblings only. It carries no
 * offsets, so a node that moved down a file keeps its path — which is what lets
 * a reader separate "new" from "moved". See react/node-path.ts for the format.
 *
 * Host elements are absent: the metric is about component choices. Unresolved
 * elements are absent too — they are already reported in `unresolvedElements`,
 * and a node whose identity is unknown cannot be judged.
 */
export interface NodeRecord {
	path: string;
	file: string;
	line: number;
	/** The tag exactly as written, including dots: `Card.Header`. */
	tag: string;
	category: 'ds' | 'external' | 'local';
	module: string;
	name: string;
	weight: number;
	/** Prop names only, never values: enough to check a guideline, small enough to ship. */
	props: string[];
}
```

Add to `CensusResult`:

```ts
	/** Populated only when the census was asked for nodes. */
	nodes?: NodeRecord[];
```

Add to `DsCoverageOptions`:

```ts
	/**
	 * Emit a per-node list alongside the aggregates. Off by default so the stored
	 * shape of every committed baseline is unchanged.
	 */
	includeNodes?: boolean;
```

Add to `DsCoverageReport`:

```ts
	/** Present only when `includeNodes` was set. */
	nodes?: NodeRecord[];
```

Change `FrameworkImplementation.createCensus` to accept the flag:

```ts
	createCensus(): (
		graph: ModuleGraph,
		resolver: IdentityResolver,
		isCounted: IsCountedFile,
		includeNodes: boolean,
	) => CensusResult;
```

- [ ] **Step 4: Thread it through `index.ts`**

Replace the census call and return in `analyzeDsCoverage`:

```ts
	const includeNodes = options.includeNodes ?? false;
	const census = framework.createCensus()(graph, resolver, isCounted, includeNodes);

	return {
		framework: options.framework ?? 'react',
		dsPackages: options.dsPackages,
		censusInclude,
		censusExclude,
		files: [...graph.files.keys()].filter(isCounted).length,
		parseFailures: graph.parseFailures,
		readFailures: graph.readFailures,
		nodes: census.totals,
		dsShareOfAllNodes: share(census.totals.ds, census.totals.all),
		dsShareOfComponentNodes: share(census.totals.ds, census.totals.component),
		components: sortedComponents(census),
		unresolvedElements: census.unresolved,
		perFile: Object.fromEntries(census.perFile),
	};
```

> **Naming collision — read this.** `DsCoverageReport.nodes` is already taken by `NodeTotals`. Do **not** overwrite it. Add the record list under a distinct key.

Rename the new report key to `nodeList` in `types.ts` and everywhere below:

```ts
	/** Present only when `includeNodes` was set. */
	nodeList?: NodeRecord[];
```

and append to the return object, after `perFile`:

```ts
		...(includeNodes ? { nodeList: census.nodes ?? [] } : {}),
```

Update the test written in Step 1 to assert on `report.nodeList` and `'nodeList' in report`.

- [ ] **Step 5: Add a no-op census signature so the suite compiles**

In `react/census.ts`, widen the signature only (implementation comes in Task 2):

```ts
export function censusReactTree(
	graph: ModuleGraph,
	resolver: IdentityResolver,
	isCounted: IsCountedFile,
	includeNodes = false,
): CensusResult {
```

and return `nodes: includeNodes ? [] : undefined` from the existing return:

```ts
	return { totals, perFile, components, unresolved, nodes: includeNodes ? [] : undefined };
```

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/ -t includeNodes`
Expected: the `omits the nodes key` test PASSES; the emission test FAILS with `[]` vs the expected record. That is correct — Task 2 fills it.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage/types.ts \
        lib/agentic-reference/metrics/ds-coverage/index.ts \
        lib/agentic-reference/metrics/ds-coverage/react/census.ts \
        lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts
git commit -m "Add the includeNodes option and NodeRecord shape to ds-coverage

Off by default, and under nodeList rather than nodes, so the report shape every
committed baseline stores is byte-identical to what it was."
```

---

### Task 2: AST path construction

**Files:**
- Create: `lib/agentic-reference/metrics/ds-coverage/react/node-path.ts`
- Test: `lib/agentic-reference/metrics/ds-coverage/react/node-path.test.ts`

- [ ] **Step 1: Write the failing test**

Create `react/node-path.test.ts`:

```ts
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildNodePath, elementTag, propNames } from './node-path.ts';

/** Every JSX element in `source`, paired with the path built for it. */
function paths(source: string): string[] {
	const sourceFile = ts.createSourceFile(
		'test.tsx',
		source,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TSX,
	);
	const seen = new Map<string, number>();
	const out: string[] = [];
	const walk = (node: ts.Node): void => {
		if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
			out.push(buildNodePath(node, seen));
		}
		ts.forEachChild(node, walk);
	};
	walk(sourceFile);
	return out;
}

describe('buildNodePath', () => {
	it('names the enclosing declaration and indexes element siblings', () => {
		expect(paths('const App = () => <div><A /><B /></div>')).toEqual([
			'App/div[0]',
			'App/div[0]/A[0]',
			'App/div[0]/B[1]',
		]);
	});

	// Text and expression children are not elements, so they must not advance
	// the index — otherwise adding a label would renumber every sibling.
	it('ignores text and expression children when indexing', () => {
		expect(paths('const App = () => <div>hi {x} <A /></div>')).toEqual([
			'App/div[0]',
			'App/div[0]/A[0]',
		]);
	});

	// The path describes the source. The resolved identity travels beside it.
	it('uses the dotted tag text for member expressions', () => {
		expect(paths('const App = () => <Card.Header />')).toEqual(['App/Card.Header[0]']);
	});

	// Fragments render nothing, so wrapping a subtree in one must not change any
	// path — the census already treats them as non-rendering.
	it('makes fragments transparent to both segments and indices', () => {
		const withFragment = paths('const App = () => <div><><A /><B /></></div>');
		const without = paths('const App = () => <div><A /><B /></div>');
		expect(withFragment).toEqual(without);
	});

	// Two root elements in one declaration would otherwise collide, and a
	// colliding path cannot answer "is this new or did it move?".
	it('disambiguates repeated paths within a file', () => {
		expect(paths('const App = () => ok ? <A /> : <A />')).toEqual(['App/A[0]', 'App/A[0]#2']);
	});

	it('falls back to <module> outside any named declaration', () => {
		expect(paths('export default <A />')).toEqual(['<module>/A[0]']);
	});
});

describe('elementTag', () => {
	it('reads the tag off both element spellings', () => {
		const source = ts.createSourceFile(
			'test.tsx',
			'const A = () => <Outer><Inner /></Outer>',
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TSX,
		);
		const tags: string[] = [];
		const walk = (node: ts.Node): void => {
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) tags.push(elementTag(node));
			ts.forEachChild(node, walk);
		};
		walk(source);
		expect(tags).toEqual(['Outer', 'Inner']);
	});
});

describe('propNames', () => {
	it('lists attribute names and marks spreads', () => {
		const source = ts.createSourceFile(
			'test.tsx',
			'const A = () => <B variant="x" {...rest} onClick={f} />',
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TSX,
		);
		let names: string[] = [];
		const walk = (node: ts.Node): void => {
			if (ts.isJsxSelfClosingElement(node)) names = propNames(node);
			ts.forEachChild(node, walk);
		};
		walk(source);
		expect(names).toEqual(['variant', '...', 'onClick']);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/react/node-path.test.ts`
Expected: FAIL — `Cannot find module './node-path.ts'`.

- [ ] **Step 3: Write the implementation**

Create `react/node-path.ts`:

```ts
// How a JSX element is addressed in the node census.
//
// The format is `<declaration>/<Tag>[i]/<Tag>[i]…`, where `i` indexes element
// siblings only. It deliberately carries no line or character offsets: a node
// that moved down a file because something was inserted above it keeps the same
// path, which is what lets a reader separate a genuinely new node from a
// relocated one.
//
// Fragments are transparent — they render nothing, so wrapping a subtree in one
// must not renumber it. Member expressions keep their dotted source text; the
// resolved identity travels beside the path in the record's module/name.
import ts from 'typescript';

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

function isJsxNode(node: ts.Node): node is JsxNode {
	return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

/** The tag exactly as written, for either element spelling. */
export function elementTag(element: JsxNode): string {
	return (ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName).getText();
}

/** Attribute names in source order; a spread contributes the literal `...`. */
export function propNames(element: JsxNode): string[] {
	const attributes = ts.isJsxElement(element)
		? element.openingElement.attributes
		: element.attributes;
	return attributes.properties.map((property) =>
		ts.isJsxAttribute(property) ? property.name.getText() : '...',
	);
}

/** The element children of a container, with fragments spliced in place. */
function elementChildren(container: ts.JsxElement | ts.JsxFragment): JsxNode[] {
	return container.children.flatMap((child) => {
		if (ts.isJsxFragment(child)) return elementChildren(child);
		return isJsxNode(child) ? [child] : [];
	});
}

/** The nearest enclosing JSX container, looking through fragments. */
function containerOf(element: JsxNode): ts.JsxElement | undefined {
	let node: ts.Node | undefined = element.parent;
	while (node !== undefined && ts.isJsxFragment(node)) node = node.parent;
	return node !== undefined && ts.isJsxElement(node) ? node : undefined;
}

const NAMED_DECLARATIONS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.VariableDeclaration,
	ts.SyntaxKind.FunctionDeclaration,
	ts.SyntaxKind.ClassDeclaration,
	ts.SyntaxKind.MethodDeclaration,
	ts.SyntaxKind.PropertyAssignment,
	ts.SyntaxKind.PropertyDeclaration,
]);

/** The nearest named declaration around the element, or `<module>` for none. */
function declarationName(element: JsxNode): string {
	for (let node: ts.Node | undefined = element.parent; node; node = node.parent) {
		if (!NAMED_DECLARATIONS.has(node.kind)) continue;
		const name = (node as { name?: ts.Node }).name;
		if (name !== undefined && ts.isIdentifier(name)) return name.text;
	}
	return '<module>';
}

/**
 * The path for one element. `seen` counts paths already emitted for this file so
 * repeats can be disambiguated: two root elements of one declaration (`cond ? <A/> : <A/>`)
 * would otherwise share a path, and a colliding path answers no question.
 *
 * Pass a fresh map per file.
 */
export function buildNodePath(element: JsxNode, seen: Map<string, number>): string {
	const segments: string[] = [];
	for (let node: JsxNode | undefined = element; node; node = containerOf(node)) {
		const container = containerOf(node);
		const index = container === undefined ? 0 : elementChildren(container).indexOf(node);
		segments.unshift(`${elementTag(node)}[${index === -1 ? 0 : index}]`);
	}

	const base = `${declarationName(element)}/${segments.join('/')}`;
	const occurrence = (seen.get(base) ?? 0) + 1;
	seen.set(base, occurrence);
	return occurrence === 1 ? base : `${base}#${occurrence}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/react/node-path.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage/react/node-path.ts \
        lib/agentic-reference/metrics/ds-coverage/react/node-path.test.ts
git commit -m "Address JSX nodes by a relocation-stable AST path

Offsets are deliberately absent: a node pushed down a file by an insertion
above it keeps its path, which is what separates a new node from a moved one.
Fragments are transparent and repeats are disambiguated, so a path can carry
that question on its own."
```

---

### Task 3: Emit records from the census

**Files:**
- Modify: `lib/agentic-reference/metrics/ds-coverage/react/census.ts:75-177`
- Test: `lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts`

- [ ] **Step 1: Run the Task 1 test to confirm it still fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts -t 'emits one record'`
Expected: FAIL — `nodeList` is `[]`.

- [ ] **Step 2: Implement emission**

In `react/census.ts`, add the import:

```ts
import { buildNodePath, propNames } from './node-path.ts';
```

Add to the imported types: `NodeRecord`.

Inside `censusReactTree`, declare the accumulator beside `unresolved`:

```ts
	const nodes: NodeRecord[] = [];
```

Inside the `for (const file of graph.files.values())` loop, after `const fileTotals = emptyTotals();`:

```ts
		// Fresh per file: paths are disambiguated within a file, not across the tree.
		const seenPaths = new Map<string, number>();
```

Change the `count` closure signature to receive the element in its narrowed form. Replace the two call sites in `walk`:

```ts
			if (ts.isJsxElement(node)) {
					count(node.openingElement.tagName, node, weight);
			} else if (ts.isJsxSelfClosingElement(node)) {
					count(node.tagName, node, weight);
```

with

```ts
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
				count(ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName, node, weight);
```

and change `count`'s parameter type from `element: ts.Node` to
`element: ts.JsxElement | ts.JsxSelfClosingElement`.

Then, inside the `resolution.category === 'ds' | 'external' | 'local'` branch, after
`components.set(key, entry);` and before `return;`:

```ts
				if (includeNodes) {
					nodes.push({
						path: buildNodePath(element, seenPaths),
						file: file.path,
						line: file.sourceFile.getLineAndCharacterOfPosition(element.getStart()).line + 1,
						tag: tag.getText(),
						category: resolution.category,
						module: resolution.module,
						name: resolution.name,
						weight,
						props: propNames(element),
					});
				}
```

Finally return them:

```ts
	return { totals, perFile, components, unresolved, nodes: includeNodes ? nodes : undefined };
```

- [ ] **Step 3: Run the test**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts -t includeNodes`
Expected: PASS, 2 tests.

- [ ] **Step 4: Add coverage for what must NOT be emitted**

Append to the `includeNodes` describe block:

```ts
	it('omits host and unresolved elements', () => {
		vol.fromJSON(
			{
				'src/App.tsx': [
					"import { Button } from '@ds/react'",
					"import Mystery from './missing'",
					'export const App = () => <div><Button /><Mystery /></div>',
				].join('\n'),
			},
			ROOT,
		);
		const report = analyzeDsCoverage({
			projectDir: ROOT,
			dsPackages: ['@ds/*'],
			includeNodes: true,
		});
		expect(report.nodeList?.map((node) => node.tag)).toEqual(['Button']);
		expect(report.unresolvedElements.map((element) => element.tag)).toEqual(['Mystery']);
	});

	// censusInclude is how the judge keeps its treatment-side census small: the
	// graph is still whole, so imports resolve, but only touched files are listed.
	it('lists only files the census counts', () => {
		vol.fromJSON(
			{
				'src/Kept.tsx': "import { Button } from '@ds/react'\nexport const Kept = () => <Button />",
				'src/Skipped.tsx':
					"import { Button } from '@ds/react'\nexport const Skipped = () => <Button />",
			},
			ROOT,
		);
		const report = analyzeDsCoverage({
			projectDir: ROOT,
			dsPackages: ['@ds/*'],
			includeNodes: true,
			censusInclude: ['src/Kept.tsx'],
		});
		expect(report.nodeList?.map((node) => node.file)).toEqual(['src/Kept.tsx']);
	});
```

- [ ] **Step 5: Run the full ds-coverage suite**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/`
Expected: PASS, all tests including the pre-existing ones.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/agentic-reference/metrics/ds-coverage/react/census.ts \
        lib/agentic-reference/metrics/ds-coverage/ds-coverage.test.ts
git commit -m "Emit per-node records from the React census

Only component elements: hosts are not a design-system decision, and an
unresolved tag cannot be judged — it is already reported separately."
```

---

### Task 4: `--nodes` flag on the human CLI

**Files:**
- Modify: `scripts/ds-coverage.ts:25-40,76-79`

- [ ] **Step 1: Add the flag to `parseArgs` and the usage string**

In the `USAGE` constant, extend the first line:

```ts
const USAGE =
	'usage: node scripts/ds-coverage.ts <dir> --ds <pattern> [--ds <pattern>...] ' +
	'[--include <glob>...] [--exclude <glob>...] [--nodes] [--json] [--per-file] [--top <n>]\n' +
	'       globs are relative to <dir>; counted files match any --include (all when none) and no --exclude';
```

In the `options` object passed to `parseArgs`, after `exclude`:

```ts
		nodes: { type: 'boolean', default: false },
```

- [ ] **Step 2: Pass it to the analyzer**

Replace the `analyzeDsCoverage` call:

```ts
	report = analyzeDsCoverage({
		projectDir: dir,
		dsPackages,
		censusInclude,
		censusExclude,
		includeNodes: values.nodes,
	});
```

- [ ] **Step 3: Render it in the human view**

After the `if (values['per-file'])` block at the end of the file:

```ts
if (values.nodes && report.nodeList) {
	console.log(`\nNodes (${report.nodeList.length}):`);
	for (const node of report.nodeList.slice(0, top)) {
		console.log(`  [${node.category}] ${node.file}:${node.line}  ${node.path}`);
	}
	if (report.nodeList.length > top) {
		console.log(`  … ${report.nodeList.length - top} more (use --json for all)`);
	}
}
```

- [ ] **Step 4: Verify by hand against this repo's own source**

Run:
```bash
node scripts/ds-coverage.ts ../apps/internal-storybook --ds '@storybook/*' --nodes --top 5
```
Expected: the usual tables, then a `Nodes (N):` section listing `[external] path:line  Decl/Tag[0]` lines. If the fixture has no JSX the section prints `Nodes (0):` — that is a pass, not a failure.

Run: `node scripts/ds-coverage.ts . --ds '@ds/*'`
Expected: unchanged output, no `Nodes` section.

- [ ] **Step 5: Commit**

```bash
git add scripts/ds-coverage.ts
git commit -m "Expose the node census through the ds-coverage CLI as --nodes"
```

---

**Phase A is complete.** Checkpoint before Phase B:

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-coverage/ && pnpm exec tsc --noEmit && pnpm format:check`
Expected: all green. Run `pnpm format` first if `format:check` complains.

---

## Phase B — Baseline re-key and node sidecar

> **Why this is here at all:** `baselines/701-new-ui-flow/…base-ui-v1.json` and
> `baselines/703-fix-bug-flow/…base-ui-v1.json` are byte-identical apart from
> their `eval` field. The agentic-reference baseline branch reads only
> `projectDir` and `pin`; the per-eval keying is contract generality that nothing
> uses. Verify this yourself before starting — it is a one-command check:
>
> ```bash
> diff <(python3 -c "import json;d=json.load(open('baselines/701-new-ui-flow/yannbf__mealdrop@refs__tags__agentic-reference__base-ui-v1.json'));d.pop('eval');print(json.dumps(d,sort_keys=True))") \
>      <(python3 -c "import json;d=json.load(open('baselines/703-fix-bug-flow/yannbf__mealdrop@refs__tags__agentic-reference__base-ui-v1.json'));d.pop('eval');print(json.dumps(d,sort_keys=True))") \
>   && echo "identical apart from eval"
> ```

### Task 5: Key baselines on the pin alone

**Files:**
- Modify: `lib/post-analysis/types.ts` (`BaselineContext`)
- Modify: `lib/post-analysis/baseline.ts:29-148`
- Modify: `scripts/analyze-results.ts` (the `loadOrBuildBaselineAnalysis` call)
- Test: `lib/post-analysis/baseline.test.ts`

- [ ] **Step 1: Write the failing test**

In `baseline.test.ts`, replace the `describe('baselinePath')` block with:

```ts
describe('baselinePath', () => {
	it('keys on the pin alone, escaping separators in both halves', () => {
		expect(baselinePath('/b', { repo: 'owner/name', ref: 'heads/main' })).toBe(
			'/b/owner__name@heads__main.json',
		);
	});

	// The point of the re-key: one pin backs many evals, and every one of them
	// produced a byte-identical file under the old scheme.
	it('gives two evals on one pin the same path', () => {
		expect(baselinePath('/b', PIN)).toBe(baselinePath('/b', { ...PIN }));
	});
});
```

Update the shared `options()` helper to drop the two fields:

```ts
function options(overrides: Partial<Parameters<typeof loadOrBuildBaselineAnalysis>[0]> = {}) {
	return {
		pin: PIN,
		baselinesDir: join(root, 'baselines'),
		refCacheDir: join(root, 'refs'),
		postAnalysis: {
			analyzeRun: vi.fn(() => ({ files: { 'a.ts': 1 } })),
			summarize: vi.fn(),
		} as unknown as PostAnalysis,
		...overrides,
	};
}
```

Add a test asserting the context no longer carries them:

```ts
it('hands analyzeRun a baseline context of pin and tree only', async () => {
	const opts = options();
	await loadOrBuildBaselineAnalysis(opts);
	expect(opts.postAnalysis.analyzeRun).toHaveBeenCalledWith({
		mode: 'baseline',
		projectDir: join(root, 'ref-tree'),
		pin: PIN,
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/post-analysis/baseline.test.ts`
Expected: FAIL — `baselinePath` still takes three arguments; TypeScript errors on the missing `evalName`/`fixtureDir`.

- [ ] **Step 3: Narrow `BaselineContext`**

In `lib/post-analysis/types.ts`, replace the `BaselineContext` interface. It no
longer extends `TreeContext`:

```ts
/**
 * `analyzeRun` against a pinned external repo's pristine tree.
 *
 * Deliberately carries no eval: what a pinned tree is made of does not depend on
 * which eval is about to run against it, and a baseline that varied by eval
 * would be measured — and committed — once per eval for identical numbers.
 */
export interface BaselineContext {
	mode: 'baseline';
	/** Absolute path to the tree being measured. */
	projectDir: string;
	/** The pin whose materialized tree `projectDir` points at. */
	pin: ExternalRepoPin;
}
```

- [ ] **Step 4: Re-key `baseline.ts`**

Replace `baselinePath` and the `BaselineOptions` interface:

```ts
export interface BaselineOptions {
	pin: ExternalRepoPin;
	postAnalysis: PostAnalysis;
	/** Re-measure the pinned tree and overwrite the committed baseline. */
	recompute?: boolean;
	/** Overridable for testing. */
	baselinesDir?: string;
	/** Overridable for testing. */
	refCacheDir?: string;
}

/**
 * Both halves of the pin have their separators escaped, so each stays a single
 * path segment: a ref like `heads/main` would otherwise turn the filename into
 * a nested path.
 */
export function baselinePath(baselinesDir: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, `${pinSlug(pin)}.json`);
}
```

Drop `eval` from `CommittedBaseline`:

```ts
interface CommittedBaseline {
	repo: string;
	ref: string;
	/** The eval's metricsVersion at measuring time; absent for legacy files. */
	metricsVersion?: number;
	analysis: Analysis;
}
```

In `loadOrBuildBaselineAnalysis`, update the destructure, the path call, the log
line, the `analyzeRun` call, and the payload:

```ts
	const { pin, postAnalysis, recompute = false } = options;
	const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
	const path = baselinePath(baselinesDir, pin);
```

```ts
	console.log(`Measuring baseline for ${pin.repo}@${pin.ref} (${reason})`);

	const analysis = await postAnalysis.analyzeRun({ mode: 'baseline', projectDir: dir, pin });
	if (analysis === null) {
		throw new Error(
			`analyzeRun returned no baseline for ${pin.repo}@${pin.ref}; ` +
				'a postAnalysis providing deltaToBaseline must measure its pinned tree.',
		);
	}
```

```ts
	const payload: CommittedBaseline = {
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion: postAnalysis.metricsVersion,
		analysis,
	};
```

- [ ] **Step 5: Update the caller**

In `scripts/analyze-results.ts`, inside `analyzeOneRun`, replace the call:

```ts
	const baseline = await loadOrBuildBaselineAnalysis({
		pin,
		postAnalysis,
		recompute: options.recompute,
	});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm exec vitest run lib/post-analysis/`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `post-analysis.ts` errors on `context.mode === 'baseline'` narrowing, that is Task 6.

- [ ] **Step 7: Commit**

```bash
git add lib/post-analysis/types.ts lib/post-analysis/baseline.ts \
        lib/post-analysis/baseline.test.ts scripts/analyze-results.ts
git commit -m "Key baselines on the external-repo pin rather than eval-plus-pin

The agentic-reference baseline branch reads only projectDir and pin, so the
per-eval keying committed one byte-identical file per eval on a pin. Dropping
evalName and fixtureDir from BaselineContext means a module cannot quietly make
a baseline eval-dependent again."
```

---

### Task 6: Bump `metricsVersion` and migrate committed baselines

**Files:**
- Modify: `lib/agentic-reference/post-analysis.ts:579-599`
- Move: `baselines/**`

- [ ] **Step 1: Bump the version and its history note**

In `post-analysis.ts`, append to the `metricsVersion` history comment and bump:

```ts
 * - 6 taught the census subpath DS patterns, `styled('div')`, and context providers
 * - 7 re-keyed baselines on the pin alone and added the ds-misuse node sidecar
 */
export const postAnalysis: PostAnalysis = {
	analyzeRun,
	deltaToBaseline,
	summarize,
	metricsVersion: 7,
};
```

- [ ] **Step 2: Move the committed baselines**

Two evals share `base-ui-v1`, and the files are identical apart from `eval`, so
one survives and the duplicate is deleted:

```bash
cd agent-eval
git mv baselines/701-new-ui-flow/yannbf__mealdrop@refs__tags__agentic-reference__base-ui-v1.json \
       baselines/yannbf__mealdrop@refs__tags__agentic-reference__base-ui-v1.json
git rm baselines/703-fix-bug-flow/yannbf__mealdrop@refs__tags__agentic-reference__base-ui-v1.json
git mv baselines/701-agentic-ref-reuse-component-mcp/yannbf__mealdrop@ce507b345666ea8678101fccac580186b2b69b1f.json \
       baselines/yannbf__mealdrop@ce507b345666ea8678101fccac580186b2b69b1f.json
rmdir baselines/701-new-ui-flow baselines/703-fix-bug-flow baselines/701-agentic-ref-reuse-component-mcp
```

- [ ] **Step 3: Drop the now-stale `eval` key from each moved file**

```bash
for f in baselines/*.json; do
  python3 - "$f" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as handle:
    data = json.load(handle)
data.pop("eval", None)
with open(path, "w") as handle:
    json.dump(data, handle, indent="\t")
    handle.write("\n")
PY
done
pnpm format
```

- [ ] **Step 4: Verify the version bump invalidates them**

The `metricsVersion` bump to 7 makes every moved file a cache miss, so the next
`--recompute`-free analyze run rebuilds them. Confirm the mismatch path is what
fires rather than a silent reuse:

Run: `pnpm exec vitest run lib/post-analysis/baseline.test.ts -t metricsVersion`
Expected: PASS — the existing test covering version-mismatch rebuild.

- [ ] **Step 5: Commit**

```bash
git add -A baselines lib/agentic-reference/post-analysis.ts
git commit -m "Move committed baselines under the pin key and bump metricsVersion to 7

The two base-ui-v1 files were identical apart from their eval field, so one is
kept and the duplicate deleted. The version bump makes every moved file a cache
miss, rebuilding it under the current definitions rather than comparing across."
```

---

### Task 7: Pin-keyed node sidecar

**Files:**
- Modify: `lib/post-analysis/baseline.ts`
- Test: `lib/post-analysis/baseline.test.ts`

The sidecar holds the whole-tree node census for a pin. It lives beside the
baseline rather than inside it because the baseline file's own comment asks it to
stay readable in a diff, and thousands of records would end that.

- [ ] **Step 1: Write the failing test**

Append to `baseline.test.ts`:

```ts
describe('node sidecar', () => {
	it('writes the census beside the baseline, keyed on the pin', async () => {
		const opts = options({
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: {}, nodeList: [{ path: 'App/A[0]' }] })),
				summarize: vi.fn(),
				metricsVersion: 7,
			} as unknown as PostAnalysis,
		});
		await loadOrBuildBaselineAnalysis(opts);

		const sidecar = JSON.parse(
			readFileSync(nodeSidecarPath(join(root, 'baselines'), PIN), 'utf8'),
		) as Record<string, unknown>;
		expect(sidecar).toMatchObject({
			repo: PIN.repo,
			ref: PIN.ref,
			metricsVersion: 7,
			nodes: [{ path: 'App/A[0]' }],
		});
	});

	// The sidecar is the judge's baseline half; keeping it out of the committed
	// baseline is what keeps that file reviewable.
	it('keeps the node list out of the committed baseline', async () => {
		const opts = options({
			postAnalysis: {
				analyzeRun: vi.fn(() => ({ files: {}, nodeList: [{ path: 'App/A[0]' }] })),
				summarize: vi.fn(),
				metricsVersion: 7,
			} as unknown as PostAnalysis,
		});
		await loadOrBuildBaselineAnalysis(opts);

		const committed = JSON.parse(
			readFileSync(baselinePath(join(root, 'baselines'), PIN), 'utf8'),
		) as { analysis: Record<string, unknown> };
		expect('nodeList' in committed.analysis).toBe(false);
	});

	it('reads back what it wrote', () => {
		const dir = join(root, 'baselines');
		writeNodeSidecar(dir, PIN, 7, [{ path: 'App/A[0]' }] as never);
		expect(readNodeSidecar(dir, PIN, 7)).toEqual([{ path: 'App/A[0]' }]);
	});

	// A sidecar measured under other rules is worse than none: its numbers look
	// healthy and mean something else.
	it('treats a version mismatch as absent', () => {
		const dir = join(root, 'baselines');
		writeNodeSidecar(dir, PIN, 6, [{ path: 'App/A[0]' }] as never);
		expect(readNodeSidecar(dir, PIN, 7)).toBeNull();
	});
});
```

Extend the import at the top of the file:

```ts
import {
	baselinePath,
	loadOrBuildBaselineAnalysis,
	nodeSidecarPath,
	readNodeSidecar,
	writeNodeSidecar,
} from './baseline.ts';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/post-analysis/baseline.test.ts -t sidecar`
Expected: FAIL — `nodeSidecarPath` is not exported.

- [ ] **Step 3: Implement the sidecar**

In `baseline.ts`, add near the top:

```ts
import type { NodeRecord } from '../agentic-reference/metrics/ds-coverage/types.ts';

/** Where the whole-tree node census for a pin lives. */
const NODE_SIDECAR_DIR = 'ds-nodes';

interface CommittedNodeSidecar {
	repo: string;
	ref: string;
	metricsVersion?: number;
	nodes: NodeRecord[];
}

export function nodeSidecarPath(baselinesDir: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, NODE_SIDECAR_DIR, `${pinSlug(pin)}.json`);
}

export function writeNodeSidecar(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
	nodes: NodeRecord[],
): void {
	const path = nodeSidecarPath(baselinesDir, pin);
	mkdirSync(dirname(path), { recursive: true });
	const payload: CommittedNodeSidecar = { repo: pin.repo, ref: pin.ref, metricsVersion, nodes };
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');
}

/**
 * The pin's node census, or null when absent or measured under other rules.
 * A sidecar from another metricsVersion is worse than none: its records look
 * healthy and were built by a different path format.
 */
export function readNodeSidecar(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
): NodeRecord[] | null {
	const stored = readJson<CommittedNodeSidecar>(nodeSidecarPath(baselinesDir, pin));
	if (!stored || !Array.isArray(stored.nodes) || stored.metricsVersion !== metricsVersion) {
		return null;
	}
	return stored.nodes;
}
```

Add `dirname` to the `node:path` import.

In `loadOrBuildBaselineAnalysis`, after the `analysis === null` guard and before
`mkdirSync(dirname(path), …)`, split the node list off the analysis:

```ts
	// The node list rides out to its own file: the committed baseline is meant to
	// stay readable in a diff, and thousands of records would end that.
	const { nodeList, ...analysisWithoutNodes } = analysis as Analysis & {
		nodeList?: NodeRecord[];
	};
	if (nodeList !== undefined) {
		writeNodeSidecar(baselinesDir, pin, postAnalysis.metricsVersion, nodeList);
	}
```

Use `analysisWithoutNodes` in the payload and in the returned/memoized value:

```ts
	const payload: CommittedBaseline = {
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion: postAnalysis.metricsVersion,
		analysis: analysisWithoutNodes,
	};
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');

	const built = { dir, analysis: analysisWithoutNodes };
```

- [ ] **Step 4: Make the baseline branch produce a node list**

In `lib/agentic-reference/post-analysis.ts`, change the `baseline` branch of
`analyzeRun` so the pinned tree is censused with nodes on:

```ts
	if (context.mode === 'baseline') {
		const dsPackages = dsPackagesForPin(context.pin);
		return {
			...complexityForTree(context.projectDir),
			dsCoverage: dsPackages === null ? null : measureDsCoverage(context.projectDir, dsPackages),
			// Whole tree, once per pin: baseline.ts moves this into the sidecar.
			nodeList:
				dsPackages === null
					? undefined
					: analyzeDsCoverage({
							projectDir: context.projectDir,
							dsPackages,
							includeNodes: true,
						}).nodeList,
		};
	}
```

Add the import:

```ts
import { analyzeDsCoverage } from './metrics/ds-coverage/index.ts';
```

> `dsCoverageOf` takes a `PostAnalysisContext` and reads `context.pin`; it still
> works for the run branch. The baseline branch now calls `measureDsCoverage`
> directly because it needs the report twice with different options.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run lib/post-analysis/ lib/agentic-reference/post-analysis.test.ts`
Expected: PASS.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/post-analysis/baseline.ts lib/post-analysis/baseline.test.ts \
        lib/agentic-reference/post-analysis.ts
git commit -m "Store the pinned tree's node census in a pin-keyed sidecar

One baseline backs roughly 200 experiments, so the whole-tree census is
measured once per pin. It rides beside the committed baseline rather than
inside it: that file is meant to stay readable in a diff."
```

---

**Phase B checkpoint.**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm format:check`
Expected: all green.

Then rebuild the baselines and confirm the sidecar appears:

```bash
pnpm results:analyze --recompute --latest
ls baselines baselines/ds-nodes
```
Expected: `baselines/<pinSlug>.json` files and a matching `baselines/ds-nodes/<pinSlug>.json`.
If there are no local results, skip this — CI covers it.
