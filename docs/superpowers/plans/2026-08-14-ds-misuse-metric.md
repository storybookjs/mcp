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

---

## Phase C — Diff and design-system docs

### Task 8: `tree-patch.ts` — the run's diff against its baseline

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/tree-patch.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/tree-patch.test.ts`

Two facts about `git diff --no-index` that drive the implementation:
- it **exits 1 when there are differences**, which is success here, not failure;
- it emits the two absolute directory paths in every header, so without rewriting
  the judge would see two cache paths instead of `src/components/Foo.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tree-patch.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { treePatch } from './tree-patch.ts';

let root: string;

function tree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	for (const [path, contents] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), contents);
	}
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'tree-patch-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('treePatch', () => {
	it('reports no change between identical trees', () => {
		const files = { 'src/App.tsx': 'export const App = () => <div />\n' };
		const patch = treePatch(tree('before', files), tree('after', files));
		expect(patch).toEqual({ text: '', files: [], truncated: false, droppedFiles: 0 });
	});

	// Without rewriting, every header names two absolute cache directories and
	// the judge cannot tell which repo file it is looking at.
	it('rewrites both tree roots to workspace-relative paths', () => {
		const patch = treePatch(
			tree('before', { 'src/App.tsx': 'const a = 1\n' }),
			tree('after', { 'src/App.tsx': 'const a = 2\n' }),
		);
		expect(patch.files).toEqual(['src/App.tsx']);
		expect(patch.text).toContain('diff --git a/src/App.tsx b/src/App.tsx');
		expect(patch.text).not.toContain(root);
	});

	it('includes files added by the run', () => {
		const patch = treePatch(
			tree('before', { 'src/App.tsx': 'const a = 1\n' }),
			tree('after', { 'src/App.tsx': 'const a = 1\n', 'src/New.tsx': 'export const New = 1\n' }),
		);
		expect(patch.files).toEqual(['src/New.tsx']);
	});

	// The metric is about source the agent wrote. Lockfiles and harness scaffolding
	// are neither, and a lockfile alone can blow the whole byte budget.
	it('drops non-source and excluded paths', () => {
		const patch = treePatch(
			tree('before', { 'src/App.tsx': 'const a = 1\n' }),
			tree('after', {
				'src/App.tsx': 'const a = 2\n',
				'pnpm-lock.yaml': 'lockfileVersion: 9\n',
				'notes.md': 'hello\n',
				'__agent_eval__/test-utils.ts': 'export const x = 1\n',
			}),
		);
		expect(patch.files).toEqual(['src/App.tsx']);
	});

	it('cuts at a file boundary when over the cap and says how many it dropped', () => {
		const big = 'x'.repeat(4000) + '\n';
		const patch = treePatch(
			tree('before', { 'src/A.tsx': 'const a = 1\n', 'src/B.tsx': 'const b = 1\n' }),
			tree('after', { 'src/A.tsx': big, 'src/B.tsx': big }),
			{ maxBytes: 2000 },
		);
		expect(patch.truncated).toBe(true);
		expect(patch.droppedFiles).toBeGreaterThan(0);
		// Whole blocks only — a half-written hunk would read as a real edit.
		expect(patch.text.split('diff --git').length - 1).toBe(patch.files.length);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/tree-patch.test.ts`
Expected: FAIL — `Cannot find module './tree-patch.ts'`.

- [ ] **Step 3: Write the implementation**

Create `tree-patch.ts`:

```ts
// The unified diff between the pinned baseline tree and what a run left behind.
//
// tree-diff.ts already answers "which files changed" for the SLoC metrics, but
// the judge needs the actual hunks: it has to see what the agent wrote to decide
// whether a component was used correctly. That is a different question and a
// different output, so this lives beside rather than inside it.
//
// git diff --no-index is the engine. Two of its behaviours drive the code below:
// it exits 1 when the trees differ (success here), and it names both absolute
// tree roots in every header, which would leave the judge staring at two cache
// paths instead of the repo path it needs.
import { execFileSync } from 'node:child_process';

import { isExcludedPath, SOURCE_EXTENSIONS } from '../../tree/paths.ts';

/** 512 KB ≈ 128k tokens, clear of the window alongside the ~95k-token doc corpus. */
const DEFAULT_MAX_BYTES = 512 * 1024;

const DIFF_TIMEOUT_SECONDS = 120;

export interface TreePatch {
	/** The unified diff, workspace-relative and filtered. */
	text: string;
	/** Workspace-relative paths present in `text`, in order. */
	files: string[];
	/** Whether the byte cap dropped anything. */
	truncated: boolean;
	/** How many whole file blocks the cap dropped. */
	droppedFiles: number;
}

export interface TreePatchOptions {
	maxBytes?: number;
}

/** The path a `diff --git a/<x> b/<y>` header names, or null if unparseable. */
function pathOfBlock(block: string): string | null {
	const header = /^diff --git a\/(\S+) b\/(\S+)/.exec(block);
	if (header === null) return null;
	// A rename would differ; take the post-image, which is what the run produced.
	return header[2] ?? header[1] ?? null;
}

function isJudgeable(path: string): boolean {
	return SOURCE_EXTENSIONS.test(path) && !isExcludedPath(path);
}

/**
 * Diff two checked-out trees. Both roots are rewritten out of the output so the
 * result reads as repo-relative, and the whole thing is capped — cutting at a
 * file boundary, because half a hunk reads as a real edit rather than a cut.
 */
export function treePatch(
	baselineDir: string,
	projectDir: string,
	options: TreePatchOptions = {},
): TreePatch {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	let raw = '';
	try {
		raw = execFileSync(
			'git',
			['diff', '--no-index', '--no-color', '--', baselineDir, projectDir],
			{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: DIFF_TIMEOUT_SECONDS * 1000 },
		);
	} catch (error) {
		// Exit 1 is "the trees differ", which is the normal case here.
		const failure = error as { status?: number; stdout?: string; stderr?: string };
		if (failure.status !== 1) {
			throw new Error(`ds-misuse: git diff failed: ${failure.stderr ?? String(error)}`);
		}
		raw = failure.stdout ?? '';
	}

	// Longest first, so a root that prefixes the other cannot leave a fragment.
	const roots = [baselineDir, projectDir].sort((a, b) => b.length - a.length);
	const relative = roots.reduce(
		(text, root) => text.split(`${root}/`).join(''),
		raw,
	);

	const blocks = relative
		.split(/^(?=diff --git )/m)
		.map((block) => block.trim())
		.filter((block) => block.startsWith('diff --git '));

	const kept: string[] = [];
	const files: string[] = [];
	let bytes = 0;
	let droppedFiles = 0;

	for (const block of blocks) {
		const path = pathOfBlock(block);
		if (path === null || !isJudgeable(path)) continue;

		const size = Buffer.byteLength(block, 'utf8') + 1;
		if (bytes + size > maxBytes) {
			droppedFiles += 1;
			continue;
		}
		bytes += size;
		kept.push(block);
		files.push(path);
	}

	return {
		text: kept.join('\n'),
		files,
		truncated: droppedFiles > 0,
		droppedFiles,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/tree-patch.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/tree-patch.ts \
        lib/agentic-reference/metrics/ds-misuse/tree-patch.test.ts
git commit -m "Produce the run's diff against its baseline for the judge

git diff --no-index exits 1 on difference, which is the normal case, and names
both absolute tree roots in every header — so the roots are rewritten out and
the cap cuts at a file boundary, since half a hunk reads as a real edit."
```

---

### Task 9: `ds-docs.ts` — the pinned guideline corpus

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/ds-docs.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/ds-docs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ds-docs.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../external-repo.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../external-repo.ts')>()),
	prepareRef: vi.fn(),
}));

import { prepareRef } from '../../external-repo.ts';
import { collectDsDocs, DS_DOCS_PIN, dsDocsRefLabel } from './ds-docs.ts';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'ds-docs-'));
	vi.mocked(prepareRef).mockReturnValue(root);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function write(path: string, contents: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), contents);
}

describe('DS_DOCS_PIN', () => {
	// The whole point of a fixed ref: arms are served different documentation on
	// purpose, and judging each against what it saw would score a degraded arm
	// against a lowered bar.
	it('is an immutable sha, not a branch', () => {
		expect(DS_DOCS_PIN.ref).toMatch(/^[0-9a-f]{40}$/);
		expect(DS_DOCS_PIN.repo).toBe('yannbf/droppy-ds');
	});

	it('labels itself repo@sha for the artifact', () => {
		expect(dsDocsRefLabel()).toBe(`${DS_DOCS_PIN.repo}@${DS_DOCS_PIN.ref}`);
	});
});

describe('collectDsDocs', () => {
	it('collects mdx from components and docs, sorted for a stable cache prefix', () => {
		write('src/components/Button/Button.mdx', '# Button\n');
		write('src/components/Card/Card.mdx', '# Card\n');
		write('src/docs/BrandGuidelines.mdx', '# Brand\n');
		write('src/components/Button/Button.tsx', 'export const Button = 1\n');
		write('README.md', '# nope\n');

		expect(collectDsDocs('/cache').map((doc) => doc.path)).toEqual([
			'src/components/Button/Button.mdx',
			'src/components/Card/Card.mdx',
			'src/docs/BrandGuidelines.mdx',
		]);
	});

	it('carries each document's text', () => {
		write('src/docs/BrandGuidelines.mdx', '# Brand\nUse tokens.\n');
		expect(collectDsDocs('/cache')[0]).toEqual({
			path: 'src/docs/BrandGuidelines.mdx',
			text: '# Brand\nUse tokens.\n',
		});
	});

	// A silent empty corpus would produce a confidently wrong judgement.
	it('throws when the ref carries no mdx at all', () => {
		expect(() => collectDsDocs('/cache')).toThrow(/no MDX/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/ds-docs.test.ts`
Expected: FAIL — `Cannot find module './ds-docs.ts'`.

- [ ] **Step 3: Write the implementation**

Create `ds-docs.ts`:

```ts
// The design system's own documentation, as the judge reads it.
//
// Pinned to one immutable sha, and deliberately NOT the branch the arm under
// evaluation was served. Content variation between arms is the independent
// variable of the whole agentic-reference round — several arms run against
// deliberately degraded documentation, which is exactly the condition we expect
// misuse to show up under. Judging each arm against the docs it happened to see
// would make the arms incomparable and would score a degraded arm against a
// lowered bar. Every arm is judged against the complete guidelines.
//
// Moving this pin is a deliberate, reviewable edit. Artifacts record the ref
// they were judged against, so a moved pin invalidates them rather than silently
// mixing two standards in one table.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { prepareRef, type ExternalRepoPin } from '../../external-repo.ts';

/**
 * yannbf/droppy-ds at main, 2026-08-14. 43 MDX files: 33 component docs plus
 * src/docs/, of which BrandGuidelines, ChoosingComponents, TechnicalGuidelines
 * and AccessibilityGuidelines carry the rules the judge scores against.
 */
export const DS_DOCS_PIN: ExternalRepoPin = {
	repo: 'yannbf/droppy-ds',
	ref: 'dfe7e43eeb2ff25c95897e55e86a976ef3f7cb7d',
};

/** Directories under the DS repo whose MDX is guidance rather than scaffolding. */
const DOC_ROOTS = ['src/components', 'src/docs'];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'storybook-static']);

export interface DsDoc {
	/** Repo-relative path, for citing in the prompt. */
	path: string;
	text: string;
}

/** `repo@sha`, recorded in every artifact so a moved pin invalidates it. */
export function dsDocsRefLabel(): string {
	return `${DS_DOCS_PIN.repo}@${DS_DOCS_PIN.ref}`;
}

function mdxUnder(dir: string, root: string): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : mdxUnder(path, root);
		return entry.name.endsWith('.mdx') ? [relative(root, path)] : [];
	});
}

/**
 * Every guideline document at the pinned ref, sorted by path.
 *
 * Sorted because this block is the cached prefix of every judge request: a
 * readdir-order corpus would reorder between machines and miss the cache on
 * every first request.
 */
export function collectDsDocs(cacheDir: string): DsDoc[] {
	const root = prepareRef(cacheDir, DS_DOCS_PIN.repo, DS_DOCS_PIN.ref);
	const paths = DOC_ROOTS.flatMap((docRoot) => mdxUnder(join(root, docRoot), root)).sort();

	if (paths.length === 0) {
		throw new Error(
			`ds-misuse: no MDX found under ${DOC_ROOTS.join(' or ')} at ${dsDocsRefLabel()}. ` +
				'Judging against an empty corpus would produce confident nonsense; ' +
				'check DS_DOCS_PIN in lib/agentic-reference/metrics/ds-misuse/ds-docs.ts.',
		);
	}

	return paths.map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') }));
}
```

- [ ] **Step 4: Fix the test's apostrophe**

The test name `carries each document's text` contains an unescaped apostrophe
inside a single-quoted string. Change that line to:

```ts
	it('carries the text of each document', () => {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/ds-docs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the pin resolves for real (one network call)**

Run:
```bash
node -e "
const { collectDsDocs } = await import('./lib/agentic-reference/metrics/ds-misuse/ds-docs.ts');
const docs = collectDsDocs('.eval-cache/refs');
console.log(docs.length, 'docs,', docs.reduce((n, d) => n + d.text.length, 0), 'chars');
console.log(docs.filter(d => d.path.startsWith('src/docs')).map(d => d.path).join('\n'));
" --input-type=module
```
Expected: `43 docs, ~379842 chars`, and the `src/docs` list includes
`BrandGuidelines.mdx`, `ChoosingComponents.mdx`, `TechnicalGuidelines.mdx`,
`AccessibilityGuidelines.mdx`. If the count differs, the pin moved — stop and
raise it rather than adjusting the assertion.

- [ ] **Step 7: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/ds-docs.ts \
        lib/agentic-reference/metrics/ds-misuse/ds-docs.test.ts
git commit -m "Pin the design-system guideline corpus the judge reads

One immutable sha, not the arm's own served branch: content variation between
arms is the round's independent variable, so judging each arm against what it
saw would score a degraded arm against a lowered bar. Sorted, because this is
the cached prefix of every request."
```

---

## Phase D — The judge

### Task 10: Result types and the output schema

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/types.ts`

- [ ] **Step 1: Write the types and schema**

Create `types.ts`:

```ts
// What the judge returns, and the schema that guarantees it.
//
// The schema is handed to the Messages API as output_config.format, so the model
// cannot return a shape this file does not describe. That is why there is no
// defensive parsing anywhere downstream.
import type { NodeRecord } from '../ds-coverage/types.ts';

/** Bump when the artifact's shape changes in a way a reader must notice. */
export const DS_MISUSE_SCHEMA_VERSION = 1;

/** 1 right, 0.5 ambiguous or debatable, 0 wrong. */
export type JudgeScore = 0 | 0.5 | 1;

export interface ScoredAnswer {
	score: JudgeScore;
	/** Why. A bare number is not reviewable, and this is the first thing anyone asks. */
	reason: string;
}

export interface JudgedNode {
	path: string;
	file: string;
	line: number;
	tag: string;
	kind: 'ds' | 'local';
	/** DS nodes only. */
	correctDsDecision?: ScoredAnswer;
	/** DS nodes only. */
	correctDsUsage?: ScoredAnswer;
	/** Local nodes only. */
	correctLocalDecision?: ScoredAnswer;
}

/** Exactly what the model is constrained to return. */
export interface JudgeResponse {
	nodes: JudgedNode[];
}

export interface DsMisuseSummary {
	/** Mean over DS nodes, or null when none were evaluated. */
	correctDsDecision: number | null;
	correctDsUsage: number | null;
	/** Mean over local nodes, or null when none were evaluated. */
	correctLocalDecision: number | null;
	evaluated: { ds: number; local: number };
}

export interface DsMisuseReport {
	schemaVersion: number;
	/** The metricsVersion the node census was built under. */
	metricsVersion: number | undefined;
	judgedAt: string;
	model: string;
	/** `repo@sha` of the guidelines. A moved pin invalidates this artifact. */
	dsGuidelinesRef: string;
	/** `repo@ref` of the tree the run worked on. */
	fixtureRef: string;
	diffTruncated: boolean;
	summary: DsMisuseSummary;
	nodes: JudgedNode[];
}

/** What the judge is given about one side of the comparison. */
export interface NodeCensus {
	nodes: NodeRecord[];
}

const SCORED_ANSWER = {
	type: 'object',
	properties: {
		score: { type: 'number', enum: [0, 0.5, 1] },
		reason: { type: 'string' },
	},
	required: ['score', 'reason'],
	additionalProperties: false,
} as const;

/**
 * The JSON schema handed to output_config.format.
 *
 * Written out rather than generated: `additionalProperties: false` is required
 * on every object, recursion is unsupported, and the two per-kind score groups
 * are deliberately optional rather than nullable — a local node has no
 * correct-ds-decision to give, and a null there would read as a zero.
 */
export const JUDGE_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		nodes: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					path: { type: 'string' },
					file: { type: 'string' },
					line: { type: 'integer' },
					tag: { type: 'string' },
					kind: { type: 'string', enum: ['ds', 'local'] },
					correctDsDecision: SCORED_ANSWER,
					correctDsUsage: SCORED_ANSWER,
					correctLocalDecision: SCORED_ANSWER,
				},
				required: ['path', 'file', 'line', 'tag', 'kind'],
				additionalProperties: false,
			},
		},
	},
	required: ['nodes'],
	additionalProperties: false,
} as const;
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/types.ts
git commit -m "Define the ds-misuse artifact shape and the judge's output schema

The per-kind score groups are optional rather than nullable: a local node has
no correct-ds-decision to give, and a null there would read as a zero."
```

---

### Task 11: `score.ts` — summary arithmetic

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/score.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `score.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { summariseJudgement } from './score.ts';

import type { JudgedNode } from './types.ts';

function dsNode(decision: 0 | 0.5 | 1, usage: 0 | 0.5 | 1): JudgedNode {
	return {
		path: 'App/Button[0]',
		file: 'src/App.tsx',
		line: 1,
		tag: 'Button',
		kind: 'ds',
		correctDsDecision: { score: decision, reason: 'r' },
		correctDsUsage: { score: usage, reason: 'r' },
	};
}

function localNode(decision: 0 | 0.5 | 1): JudgedNode {
	return {
		path: 'App/Row[0]',
		file: 'src/App.tsx',
		line: 2,
		tag: 'Row',
		kind: 'local',
		correctLocalDecision: { score: decision, reason: 'r' },
	};
}

describe('summariseJudgement', () => {
	it('means each score over the nodes that received it', () => {
		expect(summariseJudgement([dsNode(1, 1), dsNode(0, 0.5), localNode(1)])).toEqual({
			correctDsDecision: 0.5,
			correctDsUsage: 0.75,
			correctLocalDecision: 1,
			evaluated: { ds: 2, local: 1 },
		});
	});

	// null, not 0: "the run created no local components" and "every local
	// decision was wrong" are different findings and must not read the same.
	it('returns null for a score no node received', () => {
		expect(summariseJudgement([dsNode(1, 1)])).toMatchObject({
			correctLocalDecision: null,
			evaluated: { ds: 1, local: 0 },
		});
	});

	it('returns all nulls for an empty judgement', () => {
		expect(summariseJudgement([])).toEqual({
			correctDsDecision: null,
			correctDsUsage: null,
			correctLocalDecision: null,
			evaluated: { ds: 0, local: 0 },
		});
	});

	it('rounds to four decimals, matching how coverage stores shares', () => {
		expect(summariseJudgement([dsNode(1, 1), dsNode(1, 1), dsNode(0, 0)]).correctDsDecision).toBe(
			0.6667,
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/score.test.ts`
Expected: FAIL — `Cannot find module './score.ts'`.

- [ ] **Step 3: Write the implementation**

Create `score.ts`:

```ts
// Folding a judgement into the numbers that reach a comparison table.
import { mean, round } from '../../../utils/math.ts';

import type { DsMisuseSummary, JudgedNode } from './types.ts';

/** Four decimals, matching coverage.ts: a mean rounded to two flattens a small move. */
const SCORE_DIGITS = 4;

function meanOf(nodes: JudgedNode[], read: (node: JudgedNode) => number | undefined): number | null {
	const scores = nodes.flatMap((node) => {
		const score = read(node);
		return typeof score === 'number' ? [score] : [];
	});
	return round(mean(scores), SCORE_DIGITS);
}

/**
 * Each score is a mean over the nodes that received it, or null when none did.
 *
 * null rather than 0 throughout: a run that created no local components has not
 * scored zero on local decisions, and a stored 0 would drag every later mean.
 */
export function summariseJudgement(nodes: JudgedNode[]): DsMisuseSummary {
	return {
		correctDsDecision: meanOf(nodes, (node) => node.correctDsDecision?.score),
		correctDsUsage: meanOf(nodes, (node) => node.correctDsUsage?.score),
		correctLocalDecision: meanOf(nodes, (node) => node.correctLocalDecision?.score),
		evaluated: {
			ds: nodes.filter((node) => node.kind === 'ds').length,
			local: nodes.filter((node) => node.kind === 'local').length,
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/score.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/score.ts \
        lib/agentic-reference/metrics/ds-misuse/score.test.ts
git commit -m "Summarise a judgement, keeping null distinct from zero

A run that created no local components has not scored zero on local decisions,
and a stored 0 would drag every later mean."
```

---

### Task 12: `prompt.md` — the judge's instructions

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/prompt.md`

- [ ] **Step 1: Write the prompt**

Create `prompt.md` verbatim:

````markdown
You are auditing how well a coding agent used a design system.

An agent was given a task in a React application and made changes. You are given
the design system's complete documentation, the application's component census
before and after the agent's work, and the diff of what it changed. Your job is
to decide which component usages the agent *introduced*, and to score the design
system decisions behind them.

## Step 1 — decide what is new

You receive two lists of JSX component usages: `BASELINE NODES` (before) and
`TREATMENT NODES` (after, restricted to files the agent touched). Each node is
addressed by an AST path of the form `Declaration/Tag[i]/Tag[i]`, where `i`
indexes element siblings only. The path carries no line numbers, so a node that
merely moved down its file keeps the same path.

Using both lists and the diff, sort the treatment nodes into:

- **new** — the agent introduced this usage;
- **moved or unchanged** — this usage existed before, possibly at a different
  line, under a different parent, or in a renamed file.

Be conservative. A node whose path, tag and surrounding markup all match a
baseline node is not new, even if its line moved. A node the diff shows only as
context (an unchanged line) is not new. Renames and extractions are not new
usages: if the diff shows a block moved from one file into another, the usages
inside it moved with it.

Then split the new nodes by `category`:

- `category: "ds"` → a design system component. Score questions 1 and 2.
- `category: "local"` → a component the application defines itself. Score
  question 3.
- `category: "external"` → ignore entirely. Not our decision to judge.

## Step 2 — score each new node

Every score is `1`, `0.5`, or `0`. Use `0.5` for genuinely ambiguous or debatable
cases — not as a hedge when you have not looked closely.

**For each new DS usage:**

1. `correctDsDecision` — was this the right design system component for the job,
   or did a better design system alternative exist?
   - `1` — the right component, or no meaningfully better alternative exists.
   - `0.5` — defensible, but another DS component fits at least as well.
   - `0` — a different DS component was clearly the right choice for this job.

2. `correctDsUsage` — does this usage violate a documented guideline?
   Consider the component's own MDX, the brand guidelines, the technical
   guidelines and the accessibility guidelines. Composition rules, required
   props, forbidden prop combinations, hardcoded values that should be tokens,
   and required parts of a compound component all count.
   - `1` — no violation you can point to in the documentation.
   - `0.5` — arguably violates a guideline, or the guideline is ambiguous.
   - `0` — clearly violates a documented guideline. Name the guideline.

**For each new local usage:**

3. `correctLocalDecision` — should this have been a local component?
   - `1` — no design system component covers this, so local is right.
   - `0.5` — a DS component exists, but its API genuinely does not support a
     legitimate need here. Legitimate means the local component fulfils the
     task's goal where the DS component's existing API would not. A local
     component that merely restyles or lightly wraps a DS component is **not**
     this case.
   - `0` — a design system component with a relevant API existed and should have
     been used.

## Rules

- Judge only what the agent introduced. Pre-existing code is out of scope, even
  when it is wrong.
- Judge against the documentation you were given, not against general React or
  design-system intuition. If a practice is not documented, do not score it as a
  violation.
- Every score needs a `reason`: one or two sentences, concrete, citing the
  document or the specific alternative component by name. "Violates guidelines"
  is not a reason. "BrandGuidelines.mdx requires colour tokens; this passes a raw
  `#d70808`" is.
- If the diff is marked truncated, judge only the nodes you can actually see in
  it, and omit the rest rather than guessing.
- Return every new DS node and every new local node. Return nothing else — no
  moved nodes, no external nodes, no pre-existing nodes.
````

- [ ] **Step 2: Verify it loads as an asset**

`.md` files are not module-resolvable; the loader reads it from disk relative to
`import.meta.url`. Confirm the path resolves:

```bash
node -e "
import { readFileSync } from 'node:fs';
const text = readFileSync(new URL('./lib/agentic-reference/metrics/ds-misuse/prompt.md', 'file://' + process.cwd() + '/'), 'utf8');
console.log(text.length, 'chars,', text.split('\n').length, 'lines');
" --input-type=module
```
Expected: a non-zero character count.

- [ ] **Step 3: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/prompt.md
git commit -m "Write the DS misuse judge prompt

Bucketing is the model's job per the metric's design, so the prompt leads with
how to tell a new usage from a relocated one before it scores anything."
```

---

### Task 13: Add the Anthropic SDK dependency

**Files:**
- Modify: `agent-eval/package.json`

- [ ] **Step 1: Install**

```bash
cd agent-eval
pnpm add -D @anthropic-ai/sdk
```

- [ ] **Step 2: Verify it resolves**

Run: `node -e "import('@anthropic-ai/sdk').then((m) => console.log(typeof m.default))" --input-type=module`
Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml ../pnpm-lock.yaml
git commit -m "Add @anthropic-ai/sdk for the DS misuse judge"
```

---

### Task 14: `context.ts` — assembling the request

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/context.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildJudgeRequest } from './context.ts';

import type { NodeRecord } from '../ds-coverage/types.ts';

const DOCS = [
	{ path: 'src/docs/BrandGuidelines.mdx', text: '# Brand\nUse colour tokens.\n' },
	{ path: 'src/components/Button/Button.mdx', text: '# Button\n' },
];

const NODE: NodeRecord = {
	path: 'App/Button[0]',
	file: 'src/App.tsx',
	line: 3,
	tag: 'Button',
	category: 'ds',
	module: '@droppy/react',
	name: 'Button',
	weight: 1,
	props: ['variant'],
};

function build(overrides: Partial<Parameters<typeof buildJudgeRequest>[0]> = {}) {
	return buildJudgeRequest({
		docs: DOCS,
		baselineNodes: [],
		treatmentNodes: [NODE],
		patch: { text: 'diff --git a/src/App.tsx b/src/App.tsx\n', files: ['src/App.tsx'], truncated: false, droppedFiles: 0 },
		fixtureRef: 'yannbf/mealdrop@refs/tags/x',
		...overrides,
	});
}

describe('buildJudgeRequest', () => {
	// Caching is a prefix match: anything volatile placed before the breakpoint
	// invalidates the ~95k-token corpus on every single request.
	it('puts the stable prompt and docs in system, volatile content in messages', () => {
		const request = build();
		const system = request.system as Array<{ text: string }>;
		expect(system).toHaveLength(2);
		expect(system[0]!.text).toContain('You are auditing');
		expect(system[1]!.text).toContain('Use colour tokens.');
		expect(JSON.stringify(request.system)).not.toContain('yannbf/mealdrop');
	});

	it('marks the last system block as the cache breakpoint with a 1h ttl', () => {
		const system = build().system as Array<{ cache_control?: unknown }>;
		expect(system[0]!.cache_control).toBeUndefined();
		expect(system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
	});

	// Two runs of two different arms share the corpus byte for byte, which is the
	// only reason the cache pays for itself.
	it('produces a byte-identical system block for different runs', () => {
		expect(JSON.stringify(build().system)).toBe(
			JSON.stringify(build({ fixtureRef: 'other/repo@sha', treatmentNodes: [] }).system),
		);
	});

	it('carries both node lists and the diff in the user turn', () => {
		const text = String((build().messages[0]!.content as Array<{ text: string }>)[0]!.text);
		expect(text).toContain('BASELINE NODES');
		expect(text).toContain('TREATMENT NODES');
		expect(text).toContain('diff --git a/src/App.tsx');
		expect(text).toContain('App/Button[0]');
	});

	// The prompt tells the judge to omit what it cannot see; it has to be told.
	it('announces truncation to the judge', () => {
		const text = String(
			(
				build({
					patch: { text: 'diff --git a/src/A.tsx b/src/A.tsx\n', files: ['src/A.tsx'], truncated: true, droppedFiles: 4 },
				}).messages[0]!.content as Array<{ text: string }>
			)[0]!.text,
		);
		expect(text).toContain('TRUNCATED');
		expect(text).toContain('4');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/context.test.ts`
Expected: FAIL — `Cannot find module './context.ts'`.

- [ ] **Step 3: Write the implementation**

Create `context.ts`:

```ts
// Turning a run into one Messages API request.
//
// The ordering here is the whole cost story. Prompt caching is a prefix match
// over tools -> system -> messages, so the ~95k-token guideline corpus goes in
// `system` with the cache breakpoint on it, and everything that varies per run
// goes in `messages`, after the breakpoint. A single volatile byte placed before
// it — a timestamp, the fixture ref, a node path — would invalidate the corpus on
// every request and turn a ~$0.10 read back into a ~$1 write.
import { readFileSync } from 'node:fs';

import { JUDGE_OUTPUT_SCHEMA } from './types.ts';

import type { DsDoc } from './ds-docs.ts';
import type { TreePatch } from './tree-patch.ts';
import type { NodeRecord } from '../ds-coverage/types.ts';

export const JUDGE_MODEL = 'claude-opus-4-8';

/**
 * 1h is the longest TTL the API offers (the only values are `5m` and `1h`), and
 * it is enough for a sweep of any length because a cache read refreshes the
 * lifetime for free — what must stay under the TTL is the gap between two
 * consecutive judge calls, not the duration of the whole pass. It is chosen over
 * the cheaper `5m` default for headroom: the lifetime runs from the *start* of
 * the request that reads it, so a multi-minute generation counts against it.
 */
const CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' } as const;

/** Room for a reason per score across a large change set. */
const MAX_TOKENS = 32_000;

const PROMPT_PATH = new URL('./prompt.md', import.meta.url);

export interface JudgeRequestInput {
	docs: DsDoc[];
	baselineNodes: NodeRecord[];
	treatmentNodes: NodeRecord[];
	patch: TreePatch;
	fixtureRef: string;
}

function docsBlock(docs: DsDoc[]): string {
	return docs
		.map((doc) => `<document path="${doc.path}">\n${doc.text}\n</document>`)
		.join('\n\n');
}

/** One node per line: far cheaper than pretty-printed JSON, and just as readable. */
function nodeLines(nodes: NodeRecord[]): string {
	if (nodes.length === 0) return '(none)';
	return nodes
		.map(
			(node) =>
				`${node.path}\t${node.file}:${node.line}\t${node.category}\t${node.module}#${node.name}\tprops=[${node.props.join(',')}]`,
		)
		.join('\n');
}

function userText(input: JudgeRequestInput): string {
	const truncation = input.patch.truncated
		? `\n\nNOTE: the diff below is TRUNCATED. ${input.patch.droppedFiles} changed file(s) were dropped to fit. Judge only nodes you can see in it; omit the rest.`
		: '';

	return [
		`FIXTURE: ${input.fixtureRef}`,
		truncation.trim(),
		'',
		'BASELINE NODES (the pinned tree, before the agent worked)',
		'Format: path<TAB>file:line<TAB>category<TAB>module#name<TAB>props',
		nodeLines(input.baselineNodes),
		'',
		'TREATMENT NODES (after the agent worked, restricted to files it touched)',
		nodeLines(input.treatmentNodes),
		'',
		`DIFF (${input.patch.files.length} file(s))`,
		input.patch.text || '(no source changes)',
	]
		.filter((section) => section !== '')
		.join('\n');
}

/** The full `messages.create` parameter object, ready to stream. */
export function buildJudgeRequest(input: JudgeRequestInput) {
	return {
		model: JUDGE_MODEL,
		max_tokens: MAX_TOKENS,
		thinking: { type: 'adaptive' as const },
		output_config: {
			effort: 'high' as const,
			format: { type: 'json_schema' as const, schema: JUDGE_OUTPUT_SCHEMA },
		},
		// Stable, and in this order: the breakpoint on the last block caches both.
		system: [
			{ type: 'text' as const, text: readFileSync(PROMPT_PATH, 'utf8') },
			{ type: 'text' as const, text: docsBlock(input.docs), cache_control: CACHE_CONTROL },
		],
		messages: [
			{
				role: 'user' as const,
				content: [{ type: 'text' as const, text: userText(input) }],
			},
		],
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/context.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/context.ts \
        lib/agentic-reference/metrics/ds-misuse/context.test.ts
git commit -m "Assemble the judge request with the doc corpus behind a cache breakpoint

Caching is a prefix match, so one volatile byte before the breakpoint would
invalidate the ~95k-token corpus on every request and turn a cheap read back
into a full write."
```

---

### Task 15: `judge.ts` — the API call

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/judge.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/judge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `judge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const finalMessage = vi.fn();
const stream = vi.fn(() => ({ finalMessage }));

vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = { stream };
	},
}));

import { runJudge } from './judge.ts';

const REQUEST = {
	model: 'claude-opus-4-8',
	max_tokens: 32_000,
	system: [],
	messages: [],
} as never;

afterEach(() => {
	vi.clearAllMocks();
	delete process.env.ANTHROPIC_API_KEY;
});

describe('runJudge', () => {
	it('returns the parsed nodes from the structured response', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		finalMessage.mockResolvedValue({
			stop_reason: 'end_turn',
			content: [
				{ type: 'text', text: '{"nodes":[{"path":"App/A[0]","file":"a.tsx","line":1,"tag":"A","kind":"ds"}]}' },
			],
		});
		await expect(runJudge(REQUEST)).resolves.toEqual({
			nodes: [{ path: 'App/A[0]', file: 'a.tsx', line: 1, tag: 'A', kind: 'ds' }],
		});
	});

	// A refusal returns HTTP 200 with no usable content. Reading content[0] blindly
	// would surface as a confusing parse error three frames away from the cause.
	it('names a refusal rather than failing to parse it', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		finalMessage.mockResolvedValue({ stop_reason: 'refusal', stop_details: null, content: [] });
		await expect(runJudge(REQUEST)).rejects.toThrow(/refused/i);
	});

	it('names a truncated response rather than parsing half of it', async () => {
		process.env.ANTHROPIC_API_KEY = 'sk-test';
		finalMessage.mockResolvedValue({
			stop_reason: 'max_tokens',
			content: [{ type: 'text', text: '{"nodes":[' }],
		});
		await expect(runJudge(REQUEST)).rejects.toThrow(/max_tokens/);
	});
});

describe('assertApiKey', () => {
	it('names the variable and where to set it', async () => {
		const { assertApiKey } = await import('./judge.ts');
		expect(() => assertApiKey()).toThrow(/ANTHROPIC_API_KEY/);
		expect(() => assertApiKey()).toThrow(/\.env\.local/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/judge.test.ts`
Expected: FAIL — `Cannot find module './judge.ts'`.

- [ ] **Step 3: Write the implementation**

Create `judge.ts`:

```ts
// The one model call the metric makes.
//
// Streamed rather than awaited whole: max_tokens is high enough that a
// non-streaming request risks an HTTP timeout, and .finalMessage() gives the
// assembled message back anyway.
import Anthropic from '@anthropic-ai/sdk';

import type { JudgeResponse } from './types.ts';

/**
 * Fail before any work is thrown away, and say where the key goes — the eval
 * suite reads it from .env.local, which is not obvious from an SDK error.
 */
export function assertApiKey(): void {
	if (!process.env.ANTHROPIC_API_KEY) {
		throw new Error(
			'ds-misuse: ANTHROPIC_API_KEY is not set, and the judge cannot run without it. ' +
				'Add it to agent-eval/.env.local (see .env.example) or export it.',
		);
	}
}

/**
 * Call the judge and return its structured answer.
 *
 * The response is schema-constrained by output_config.format, so the only
 * failures worth naming are the ones that produce no usable content at all.
 */
export async function runJudge(
	request: Anthropic.MessageCreateParamsNonStreaming,
): Promise<JudgeResponse> {
	assertApiKey();
	const client = new Anthropic();

	const message = await client.messages.stream(request).finalMessage();

	if (message.stop_reason === 'refusal') {
		throw new Error(
			`ds-misuse: the judge refused this request (${message.stop_details?.category ?? 'no category'}). ` +
				'Nothing was scored; the run is left unjudged.',
		);
	}
	if (message.stop_reason === 'max_tokens') {
		throw new Error(
			'ds-misuse: the judge hit max_tokens and returned incomplete JSON. ' +
				'Raise MAX_TOKENS in context.ts, or judge a smaller change set.',
		);
	}

	const text = message.content.find((block) => block.type === 'text');
	if (text === undefined) {
		throw new Error(`ds-misuse: the judge returned no text block (stop_reason: ${message.stop_reason}).`);
	}

	return JSON.parse(text.text) as JudgeResponse;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/judge.test.ts`
Expected: PASS, 4 tests.

If the `assertApiKey` test fails because a real `ANTHROPIC_API_KEY` is exported in
your shell, that is the test doing its job — run it with the variable unset:
`env -u ANTHROPIC_API_KEY pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/judge.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/judge.ts \
        lib/agentic-reference/metrics/ds-misuse/judge.test.ts
git commit -m "Call the judge, naming the failures that yield no usable content

A refusal is HTTP 200 with empty content and a truncation is valid-looking half
JSON; both would otherwise surface as a parse error frames from the cause."
```

---

## Phase E — Orchestration and CLI

### Task 16: Extract run discovery so both scripts share it

**Files:**
- Create: `lib/post-analysis/discovery.ts`
- Create: `lib/post-analysis/discovery.test.ts`
- Modify: `scripts/analyze-results.ts` (delete the moved code, import instead)

`findRuns`, `selectRuns` and `parseTimestamp` currently live inside
`analyze-results.ts`. The judge CLI needs exactly the same walk and the same
`--experiment` / `--since` / `--latest` semantics, and two copies would drift.

- [ ] **Step 1: Write the failing test**

Create `discovery.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRuns, selectRuns } from './discovery.ts';

let root: string;

/** results/<experiment>/<model>/<timestamp>/<eval>/run-N/project */
function run(experiment: string, timestamp: string, evalName: string, index: number): void {
	const dir = join(root, experiment, 'opus', timestamp, evalName, `run-${index}`, 'project');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.ts'), '');
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'discovery-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('findRuns', () => {
	it('reads experiment, timestamp, eval and index out of the layout', () => {
		run('arm-a', '2026-07-27T10-43-55.864Z', '701-new-ui-flow', 1);
		expect(findRuns(root)).toEqual([
			{
				runDir: join(root, 'arm-a/opus/2026-07-27T10-43-55.864Z/701-new-ui-flow/run-1'),
				projectDir: join(root, 'arm-a/opus/2026-07-27T10-43-55.864Z/701-new-ui-flow/run-1/project'),
				experiment: 'arm-a',
				model: 'opus',
				timestamp: '2026-07-27T10-43-55.864Z',
				evalName: '701-new-ui-flow',
				run: 1,
			},
		]);
	});

	it('returns nothing for a missing results directory', () => {
		expect(findRuns(join(root, 'absent'))).toEqual([]);
	});

	// A run-N directory with no collected project is a failed run, not a run.
	it('ignores a run directory with no project', () => {
		mkdirSync(join(root, 'arm-a/opus/2026-07-27T10-43-55.864Z/701/run-1'), { recursive: true });
		expect(findRuns(root)).toEqual([]);
	});
});

describe('selectRuns', () => {
	function threeRuns() {
		run('arm-a', '2026-07-01T00-00-00.000Z', '701', 1);
		run('arm-a', '2026-08-01T00-00-00.000Z', '701', 1);
		run('arm-b', '2026-07-01T00-00-00.000Z', '701', 1);
		return findRuns(root);
	}

	it('filters by experiment', () => {
		const selected = selectRuns(threeRuns(), { experiment: 'arm-b', since: null, latest: false });
		expect(selected.map((entry) => entry.experiment)).toEqual(['arm-b']);
	});

	it('filters by date, parsing the dashed-time directory format', () => {
		const selected = selectRuns(threeRuns(), {
			experiment: null,
			since: '2026-07-15',
			latest: false,
		});
		expect(selected.map((entry) => entry.timestamp)).toEqual(['2026-08-01T00-00-00.000Z']);
	});

	it('keeps only the newest timestamp per experiment when latest is set', () => {
		const selected = selectRuns(threeRuns(), { experiment: null, since: null, latest: true });
		expect(selected.map((entry) => `${entry.experiment}@${entry.timestamp}`).sort()).toEqual([
			'arm-a@2026-08-01T00-00-00.000Z',
			'arm-b@2026-07-01T00-00-00.000Z',
		]);
	});

	it('rejects an unparseable since date rather than filtering everything out', () => {
		expect(() =>
			selectRuns(threeRuns(), { experiment: null, since: 'not-a-date', latest: false }),
		).toThrow(/parseable date/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/post-analysis/discovery.test.ts`
Expected: FAIL — `Cannot find module './discovery.ts'`.

- [ ] **Step 3: Move the code**

Create `lib/post-analysis/discovery.ts` by moving the block from
`scripts/analyze-results.ts` verbatim, adding exports and a header:

```ts
// Finding stored runs on disk, and narrowing them the way every analysis CLI does.
//
// Layout: results/<experiment>/<model>/<timestamp>/<eval>/run-N/project
//
// Shared rather than duplicated: analyze-results.ts and judge-ds-misuse.ts must
// agree about what a run is and what --experiment/--since/--latest select, or
// the two will quietly disagree about which runs they covered.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Run {
	runDir: string;
	projectDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
}

export interface RunSelection {
	experiment: string | null;
	since: string | null;
	latest: boolean;
}

export function findRuns(resultsDir: string): Run[] {
	if (!existsSync(resultsDir)) return [];
	const runs: Run[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(resultsDir.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0]!,
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3)!,
				evalName: parts.at(-2)!,
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(resultsDir);
	return runs;
}

// Result directories are ISO timestamps with the time's ':' replaced by '-',
// e.g. 2026-07-27T10-43-55.864Z.
export function parseTimestamp(timestamp: string): Date {
	return new Date(timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}

export function selectRuns(runs: Run[], options: RunSelection): Run[] {
	let selected = runs;
	if (options.experiment) {
		selected = selected.filter((run) => run.experiment === options.experiment);
	}
	if (options.since) {
		const since = new Date(options.since);
		if (Number.isNaN(since.getTime())) {
			throw new Error(`--since must be a parseable date; received "${options.since}"`);
		}
		selected = selected.filter((run) => parseTimestamp(run.timestamp) >= since);
	}
	if (options.latest) {
		const newest = new Map<string, string>();
		for (const run of selected) {
			const current = newest.get(run.experiment);
			if (current === undefined || run.timestamp > current)
				newest.set(run.experiment, run.timestamp);
		}
		selected = selected.filter((run) => run.timestamp === newest.get(run.experiment));
	}
	return selected;
}
```

- [ ] **Step 4: Delete the originals and import instead**

In `scripts/analyze-results.ts`, delete the `--- discovery ---` section (the
`Run` interface, `findRuns`, `parseTimestamp`, `selectRuns`) and add:

```ts
import { findRuns, selectRuns, type Run } from '#lib/post-analysis/discovery';
```

`PostAnalysisOptions` already carries `experiment`, `since` and `latest`, so the
existing `selectRuns(findRuns(RESULTS_DIR), options)` call compiles unchanged.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run lib/post-analysis/ && pnpm exec tsc --noEmit`
Expected: PASS, no type errors.

Run: `pnpm results:analyze --latest`
Expected: identical output to before the move. If there are no local results it
prints `No analysable runs found under results/.` — also a pass.

- [ ] **Step 6: Commit**

```bash
git add lib/post-analysis/discovery.ts lib/post-analysis/discovery.test.ts \
        scripts/analyze-results.ts
git commit -m "Extract run discovery so the judge CLI shares it

Two copies of the walk would drift, and the two scripts must agree about what
a run is and what --experiment/--since/--latest select."
```

---

### Task 17: `index.ts` — orchestration and the artifact

**Files:**
- Create: `lib/agentic-reference/metrics/ds-misuse/index.ts`
- Test: `lib/agentic-reference/metrics/ds-misuse/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `index.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DS_MISUSE_FILENAME, isStale, readMisuseReport, writeMisuseReport } from './index.ts';

import type { DsMisuseReport } from './types.ts';

let runDir: string;

function report(overrides: Partial<DsMisuseReport> = {}): DsMisuseReport {
	return {
		schemaVersion: 1,
		metricsVersion: 7,
		judgedAt: '2026-08-14T00:00:00.000Z',
		model: 'claude-opus-4-8',
		dsGuidelinesRef: 'yannbf/droppy-ds@abc',
		fixtureRef: 'yannbf/mealdrop@def',
		diffTruncated: false,
		summary: {
			correctDsDecision: 1,
			correctDsUsage: 1,
			correctLocalDecision: null,
			evaluated: { ds: 1, local: 0 },
		},
		nodes: [],
		...overrides,
	};
}

beforeEach(() => {
	runDir = mkdtempSync(join(tmpdir(), 'ds-misuse-'));
});

afterEach(() => {
	rmSync(runDir, { recursive: true, force: true });
});

describe('artifact round-trip', () => {
	it('writes and reads back the report', () => {
		writeMisuseReport(runDir, report());
		expect(readMisuseReport(runDir)).toEqual(report());
	});

	it('returns null when there is none', () => {
		expect(readMisuseReport(runDir)).toBeNull();
	});

	it('returns null for an unreadable artifact rather than throwing', () => {
		mkdirSync(runDir, { recursive: true });
		writeFileSync(join(runDir, DS_MISUSE_FILENAME), '{ not json');
		expect(readMisuseReport(runDir)).toBeNull();
	});
});

describe('isStale', () => {
	// Judging costs money; a fresh artifact must not be re-spent on.
	it('is false for an artifact matching the current pins and versions', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@abc', metricsVersion: 7 })).toBe(
			false,
		);
	});

	// A moved guidelines pin means the run was judged against another standard.
	it('is true when the guidelines pin moved', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@zzz', metricsVersion: 7 })).toBe(
			true,
		);
	});

	// A different metricsVersion means the node paths were built differently.
	it('is true when the metrics version moved', () => {
		expect(isStale(report(), { dsGuidelinesRef: 'yannbf/droppy-ds@abc', metricsVersion: 8 })).toBe(
			true,
		);
	});

	it('is true for a report from an older schema', () => {
		expect(
			isStale(report({ schemaVersion: 0 }), {
				dsGuidelinesRef: 'yannbf/droppy-ds@abc',
				metricsVersion: 7,
			}),
		).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/index.test.ts`
Expected: FAIL — `Cannot find module './index.ts'`.

- [ ] **Step 3: Write the implementation**

Create `index.ts`:

```ts
// The ds-misuse metric: how well a run used the design system.
//
// ds-coverage answers how *much* of a run's UI came from the design system.
// This answers whether the agent chose well — right component, used the way the
// guidelines say, and local only where nothing in the system fit.
//
// It is the one metric in this tree that is not a pure function of stored
// artifacts: it calls a model, so it lives behind its own CLI rather than in
// post-analysis, and its result is cached on disk as ds-misuse.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from '../../../utils/files.ts';
import { buildJudgeRequest, JUDGE_MODEL } from './context.ts';
import { collectDsDocs, dsDocsRefLabel } from './ds-docs.ts';
import { runJudge } from './judge.ts';
import { summariseJudgement } from './score.ts';
import { treePatch } from './tree-patch.ts';
import { DS_MISUSE_SCHEMA_VERSION, type DsMisuseReport } from './types.ts';

import { analyzeDsCoverage } from '../ds-coverage/index.ts';
import type { NodeRecord } from '../ds-coverage/types.ts';

export const DS_MISUSE_FILENAME = 'ds-misuse.json';

export interface JudgeRunInput {
	/** The run directory; the artifact lands here. */
	runDir: string;
	/** The collected post-run tree. */
	projectDir: string;
	/** The materialized pinned tree the run started from. */
	baselineDir: string;
	/** Whole-tree node census of the pinned tree, from the sidecar. */
	baselineNodes: NodeRecord[];
	/** DS package patterns for this pin. */
	dsPackages: string[];
	/** `repo@ref` of the pin, recorded in the artifact. */
	fixtureRef: string;
	metricsVersion: number | undefined;
	/** Where prepareRef caches trees. */
	refCacheDir: string;
}

export interface StalenessCheck {
	dsGuidelinesRef: string;
	metricsVersion: number | undefined;
}

export function readMisuseReport(runDir: string): DsMisuseReport | null {
	return readJson<DsMisuseReport>(join(runDir, DS_MISUSE_FILENAME));
}

export function writeMisuseReport(runDir: string, report: DsMisuseReport): void {
	writeFileSync(join(runDir, DS_MISUSE_FILENAME), JSON.stringify(report, null, 2) + '\n');
}

/**
 * Whether a stored judgement can still be trusted.
 *
 * A moved guidelines pin means the run was scored against a different standard;
 * a moved metricsVersion means its node paths were built by different rules.
 * Either way the number is not comparable with a fresh one, so it is re-spent.
 */
export function isStale(report: DsMisuseReport, current: StalenessCheck): boolean {
	return (
		report.schemaVersion !== DS_MISUSE_SCHEMA_VERSION ||
		report.dsGuidelinesRef !== current.dsGuidelinesRef ||
		report.metricsVersion !== current.metricsVersion
	);
}

/** Judge one run and return its report. Makes exactly one model call. */
export async function judgeRun(input: JudgeRunInput): Promise<DsMisuseReport> {
	const patch = treePatch(input.baselineDir, input.projectDir);

	// Targeted: the graph is still whole so imports resolve, but only the files
	// the run touched are counted — a new JSX node can appear nowhere else.
	const treatment = analyzeDsCoverage({
		projectDir: input.projectDir,
		dsPackages: input.dsPackages,
		includeNodes: true,
		censusInclude: patch.files,
	});

	const judged = await runJudge(
		buildJudgeRequest({
			docs: collectDsDocs(input.refCacheDir),
			baselineNodes: input.baselineNodes,
			treatmentNodes: treatment.nodeList ?? [],
			patch,
			fixtureRef: input.fixtureRef,
		}) as never,
	);

	return {
		schemaVersion: DS_MISUSE_SCHEMA_VERSION,
		metricsVersion: input.metricsVersion,
		judgedAt: new Date().toISOString(),
		model: JUDGE_MODEL,
		dsGuidelinesRef: dsDocsRefLabel(),
		fixtureRef: input.fixtureRef,
		diffTruncated: patch.truncated,
		summary: summariseJudgement(judged.nodes),
		// The buckets travel with the scores: the judge chose them, so a surprising
		// number has to be traceable to what it actually counted.
		nodes: judged.nodes,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/agentic-reference/metrics/ds-misuse/index.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/agentic-reference/metrics/ds-misuse/index.ts \
        lib/agentic-reference/metrics/ds-misuse/index.test.ts
git commit -m "Orchestrate one run's judgement and cache it as ds-misuse.json

Judging costs money, so a fresh artifact is reused; a moved guidelines pin or
metricsVersion makes it stale, because either means the stored number is not
comparable with a fresh one."
```
