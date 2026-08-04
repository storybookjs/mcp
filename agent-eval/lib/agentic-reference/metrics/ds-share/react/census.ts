// The census layer: every JSX element in the tree, classified and weighted.
//
// Elements are counted one by one — a subtree never inherits its parent's
// classification; a DS Card full of raw divs contributes one DS node and many
// host nodes. Raw `createElement` calls are deliberately ignored: the census
// reads JSX syntax only.
//
// Conditionals weight, they do not exclude: a render choosing between two JSX
// subtrees counts each side's elements at half weight (nesting halves again),
// while a choice between a subtree and a falsy value or literal counts the
// subtree in full — the element renders whenever anything does.
//
// Two deliberate boundaries of that rule, both from its syntactic definition:
// halving applies to conditional *expressions* (`?:`, `&&`, `||`, `??`) whose
// branches contain JSX. Statement-level forks (`if (x) return <A/>; return
// <B/>`) count both returns in full — each is that component's own written
// render, not a branch of one expression — and a branch that hides its JSX
// behind a helper call is not a JSX subtree, so the visible side keeps full
// weight. Extending either would mean whole-program render analysis, which is
// exactly what this static census is not.
import ts from 'typescript';

import { resolveJsxTag } from './resolve.ts';

import type { ModuleGraph } from '../module-graph.ts';
import type {
	CensusResult,
	IdentityResolver,
	NodeTotals,
	Resolution,
	UnresolvedElement,
} from '../types.ts';

function emptyTotals(): NodeTotals {
	return { all: 0, host: 0, component: 0, ds: 0, external: 0, local: 0, unresolved: 0 };
}

/**
 * Whether the subtree contains an element the census would count. A named
 * `<Fragment>` is not itself countable (it renders nothing, like `<>`), but
 * elements inside it are — so `cond ? <A/> : <Fragment/>` keeps full weight
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

/** `<React.Fragment>` renders nothing, like `<>`; both are syntax, not UI. */
function isFragmentIdentity(resolution: Resolution): boolean {
	return (
		resolution.category === 'external' &&
		resolution.module === 'react' &&
		resolution.name === 'Fragment'
	);
}

export function censusReactTree(graph: ModuleGraph, resolver: IdentityResolver): CensusResult {
	const totals = emptyTotals();
	const perFile = new Map<string, NodeTotals>();
	const components = new Map<
		string,
		{ category: 'host' | 'ds' | 'external' | 'local'; count: number }
	>();
	const unresolved: UnresolvedElement[] = [];

	for (const file of graph.files.values()) {
		const fileTotals = emptyTotals();

		// Tag resolutions are memoized in the resolver, so asking again inside the
		// halving predicate costs a map lookup.
		const containsCountableJsx = makeContainsCountableJsx((element) => {
			const tag = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
			return !isFragmentIdentity(resolveJsxTag(file, tag, resolver));
		});

		const count = (tag: ts.JsxTagNameExpression, element: ts.Node, weight: number): void => {
			const resolution = resolveJsxTag(file, tag, resolver);
			if (isFragmentIdentity(resolution)) return;

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
			if (ts.isJsxElement(node)) {
				count(node.openingElement.tagName, node, weight);
			} else if (ts.isJsxSelfClosingElement(node)) {
				count(node.tagName, node, weight);
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

	return { totals, perFile, components, unresolved };
}
