// The census layer
//
// - Every JSX element in the tree is resolved to DS or not DS
// - Elements are counted one by one, e.g. a DS Card full of raw divs contributes
//   one DS node and many host nodes
// - Raw `createElement` calls are not supported yet
// - Conditional renders cause element counts on each branch to be weighted
import ts from 'typescript';

import { createNodePathBuilder, elementTag, propNames } from './node-path.ts';
import { resolveJsxTag } from './resolve.ts';

import type { ModuleGraph } from '../module-graph.ts';
import type {
	CensusResult,
	IdentityResolver,
	IsCountedFile,
	NodeRecord,
	NodeTotals,
	Resolution,
	UnresolvedElement,
} from '../types.ts';

function emptyTotals(): NodeTotals {
	return { all: 0, host: 0, component: 0, ds: 0, external: 0, local: 0, unresolved: 0 };
}

/**
 * Whether the subtree contains an element the census would count. A
 * non-rendering element (see NON_RENDERING_REACT) is not itself countable, but
 * elements inside it are, so `cond ? <A/> : <Fragment/>` keeps full weight
 * while `cond ? <A/> : <Fragment><B/></Fragment>` halves, exactly matching
 * the equivalent `<>` spellings.
 */
function makeContainsCountableJsx(
	isCountable: (element: ts.JsxElement | ts.JsxSelfClosingElement) => boolean,
): (node: ts.Node) => boolean {
	const contains = (node: ts.Node): boolean => {
		if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && isCountable(node)) {
			return true;
		}
		let found = false;
		node.forEachChild(function scan(child): void {
			if (found) return;
			if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && isCountable(child)) {
				found = true;
				return;
			}
			child.forEachChild(scan);
		});
		return found;
	};
	return contains;
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * React elements that render no UI of their own, only their children:
 * `<React.Fragment>` (`<>`) and `<Ctx.Provider>` or `<Ctx.Consumer>`
 * Counting them would skew component total against DS coverage.
 */
const NON_RENDERING_REACT = new Set(['Fragment', 'Context.Provider', 'Context.Consumer']);

function isNonRenderingIdentity(resolution: Resolution): boolean {
	return (
		resolution.category === 'external' &&
		resolution.module === 'react' &&
		NON_RENDERING_REACT.has(resolution.name)
	);
}

export function censusReactTree(
	graph: ModuleGraph,
	resolver: IdentityResolver,
	isCounted: IsCountedFile,
	includeNodes: boolean,
): CensusResult {
	const totals = emptyTotals();
	const perFile = new Map<string, NodeTotals>();
	const components = new Map<
		string,
		{ category: 'host' | 'ds' | 'external' | 'local'; count: number }
	>();
	const unresolved: UnresolvedElement[] = [];
	const nodeList: NodeRecord[] = [];

	for (const file of graph.files.values()) {
		// Skipping the walk for filtered out files.
		if (!isCounted(file.path)) {
			continue;
		}

		const fileTotals = emptyTotals();

		// One builder per file: paths are disambiguated within a file, not across
		// the tree. The builder must also see every counted element exactly once,
		// in an order the baseline census reproduces — its `#n` suffix counts
		// visit order, so a different walk renumbers every colliding path.
		const nextPath = createNodePathBuilder();

		// Tag resolutions are memoized in the resolver, so asking again inside the
		// halving predicate costs a map lookup.
		const containsCountableJsx = makeContainsCountableJsx((element) => {
			const tag = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
			return !isNonRenderingIdentity(resolveJsxTag(file, tag, resolver));
		});

		const count = (
			tag: ts.JsxTagNameExpression,
			element: ts.JsxElement | ts.JsxSelfClosingElement,
			weight: number,
		): void => {
			const resolution = resolveJsxTag(file, tag, resolver);
			if (isNonRenderingIdentity(resolution)) return;

			totals.all += weight;
			fileTotals.all += weight;

			if (resolution.category === 'host') {
				totals.host += weight;
				fileTotals.host += weight;
				const entry = components.get(resolution.tag) ?? { category: 'host' as const, count: 0 };
				entry.count += weight;
				components.set(resolution.tag, entry);
				return;
			}

			totals.component += weight;
			fileTotals.component += weight;

			if (
				resolution.category === 'ds' ||
				resolution.category === 'external' ||
				resolution.category === 'local'
			) {
				totals[resolution.category] += weight;
				fileTotals[resolution.category] += weight;
				const key = `${resolution.module}#${resolution.name}`;
				const entry = components.get(key) ?? { category: resolution.category, count: 0 };
				entry.count += weight;
				components.set(key, entry);
				if (includeNodes) {
					nodeList.push({
						path: nextPath(element),
						file: file.path,
						line: file.sourceFile.getLineAndCharacterOfPosition(element.getStart()).line + 1,
						tag: elementTag(element),
						category: resolution.category,
						module: resolution.module,
						name: resolution.name,
						weight,
						props: propNames(element),
					});
				}
				return;
			}

			// namespace/object resolutions are not renderables; a tag resolving to
			// one is as unresolved as a tag resolving to nothing.
			const reason =
				resolution.category === 'unresolved'
					? resolution.reason
					: `tag resolves to a ${resolution.category}`;
			totals.unresolved += weight;
			fileTotals.unresolved += weight;
			const line = file.sourceFile.getLineAndCharacterOfPosition(element.getStart()).line + 1;
			unresolved.push({ file: file.path, line, tag: tag.getText(), weight, reason });
		};

		const walk = (node: ts.Node, weight: number): void => {
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
				count(ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName, node, weight);
			} else if (ts.isConditionalExpression(node)) {
				// Both branches JSX -> each side at half weight; otherwise the JSX
				// side renders whenever anything does and keeps full weight.
				const halve = containsCountableJsx(node.whenTrue) && containsCountableJsx(node.whenFalse);
				const branchWeight = halve ? weight / 2 : weight;
				walk(node.condition, weight);
				walk(node.whenTrue, branchWeight);
				walk(node.whenFalse, branchWeight);
				return;
			} else if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
				const halve = containsCountableJsx(node.left) && containsCountableJsx(node.right);
				const branchWeight = halve ? weight / 2 : weight;
				walk(node.left, branchWeight);
				walk(node.right, branchWeight);
				return;
			}
			ts.forEachChild(node, (child) => walk(child, weight));
		};

		walk(file.sourceFile, 1);
		if (fileTotals.all > 0) perFile.set(file.path, fileTotals);
	}

	return { totals, perFile, components, unresolved, nodeList: includeNodes ? nodeList : undefined };
}
