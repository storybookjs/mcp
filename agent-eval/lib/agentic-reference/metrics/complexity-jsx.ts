// JSX-aware variants of the cyclomatic and cognitive complexity walkers.
//
// The classic metrics treat markup as invisible: a 40-element render tree eight
// levels deep scores the same as `return null` unless it happens to contain a
// ternary. For component-heavy code that under-measures exactly the structure
// an agent is most likely to bloat. These variants make markup count, each in
// its parent metric's own style:
//
//   jsxCyclomaticForSource — flat counting, like cyclomatic.
//     +1 per JSX element        markup length: every tag is output the reader
//                               must account for (fragments render nothing and
//                               are free)
//     +1 per render callback    `{items.map((item) => <li/>)}` is the markup
//                               analog of a `for` loop, which the classic
//                               metric misses because the callback boundary
//                               hides it
//     Conditional renders (`?:`, `&&`) are decision points the classic core
//     already counts, so the branch term comes built in.
//
//   jsxCognitiveForSource — depth-weighted, like Sonar cognitive.
//     JSX elements deepen nesting, so a branch buried in markup costs more
//     than one at the top of the function. Structural elements — those with
//     markup children — cost 1 + depth, making deep trees cost superlinearly
//     exactly as nested ifs do; leaf elements are free (width is
//     jsxCyclomatic's business, depth is this metric's). Render callbacks
//     cost 1 + depth like any loop, and a conditional render in child
//     position (`{cond && <A/>}`) is charged as a branch of the markup,
//     1 + depth, rather than the flat operator cost of a boolean condition.
//
// Both variants are strict supersets of their classic counterparts: on source
// containing no JSX they produce identical scores, which complexity-jsx.test.ts
// holds them to against the classic implementations.
//
// Function naming follows complexity-cognitive.ts for both variants, so the
// only place the two naming schemes ever differed — a class-field arrow, which
// the cyclomatic walker names `Class.field` and the cognitive walker
// `<anonymous>` — resolves to the cognitive spelling here. Nothing downstream
// reads the names; only the summed scores are stored.
import ts from 'typescript';

import { scriptKindFor } from './sloc.ts';
import type { FunctionComplexity } from '../types.ts';

const SCRIPT_EXTENSIONS = /\.(?:tsx?|jsx?|mjs|cjs)$/;

function isFunctionLike(node: ts.Node): boolean {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	);
}

function enclosingClassName(node: ts.Node): string | undefined {
	let current: ts.Node | undefined = node.parent;
	while (current) {
		if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
			return current.name?.text ?? 'Anon';
		}
		current = current.parent;
	}
	return undefined;
}

function nameOfFunctionLike(node: ts.Node): string {
	const withClass = (raw: string): string => {
		const className = enclosingClassName(node);
		return className ? `${className}.${raw}` : raw;
	};

	if (ts.isFunctionDeclaration(node)) return node.name?.text ?? '<anonymous>';
	if (ts.isConstructorDeclaration(node)) return withClass('constructor');
	if (
		ts.isMethodDeclaration(node) ||
		ts.isGetAccessorDeclaration(node) ||
		ts.isSetAccessorDeclaration(node)
	) {
		const name = node.name;
		return withClass(
			name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : 'member',
		);
	}
	const parent = node.parent;
	if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
		return parent.name.text;
	}
	if (
		parent &&
		ts.isPropertyAssignment(parent) &&
		(ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
	) {
		return parent.name.text;
	}
	return '<anonymous>';
}

/** A rendered tag. Fragments are excluded: `<>...</>` renders no node of its own. */
function isJsxTag(node: ts.Node): boolean {
	return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

/**
 * Whether an element hosts further markup: at least one element or fragment
 * among its direct children. An element holding only text or `{...}`
 * expressions is a leaf — when such an expression branches, the branch itself
 * is charged (at this element's depth), so charging the element too would
 * price the same structure twice.
 */
function hasMarkupChildren(node: ts.JsxElement): boolean {
	return node.children.some((child) => isJsxTag(child) || ts.isJsxFragment(child));
}

/**
 * Whether a function builds markup in its own body — not through nested
 * functions, whose markup belongs to their own measurement.
 */
function containsOwnJsx(callback: ts.ArrowFunction | ts.FunctionExpression): boolean {
	const scan = (node: ts.Node): true | undefined => {
		if (isJsxTag(node) || ts.isJsxFragment(node)) return true;
		if (isFunctionLike(node)) return undefined;
		return ts.forEachChild(node, scan);
	};
	return ts.forEachChild(callback, scan) === true;
}

/**
 * A call that produces markup through an inline callback, e.g.
 * `{items.map((item) => <li/>)}` or `return rows.map(renderRow)` with an
 * inline arrow. The classic metrics price this at zero: the callback is
 * measured as its own function, so the iteration never lands anywhere. The
 * charge goes to the enclosing function, exactly where a `for` loop writing
 * the same markup would land. A named callback (`.map(renderRow)`) carries no
 * inline markup to read past, so it is not charged.
 */
function isRenderCallback(node: ts.Node): boolean {
	return (
		ts.isCallExpression(node) &&
		node.arguments.some(
			(argument) =>
				(ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
				containsOwnJsx(argument),
		)
	);
}

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * A run of like operators costs 1, not 1 per operator: `a && b && c` reads as
 * one condition. The AST nests as `(a && b) && c`, so only the outermost node
 * of a run — one whose parent is not the same operator — is charged.
 */
function startsOperatorRun(node: ts.BinaryExpression): boolean {
	const parent = node.parent;
	return !(
		parent &&
		ts.isBinaryExpression(parent) &&
		parent.operatorToken.kind === node.operatorToken.kind
	);
}

/**
 * Whether a logical-operator run renders one of its operands: it is the
 * immediate expression of a `{...}` in child position, as in
 * `<div>{cond && <A/>}</div>`. An operator in an attribute value
 * (`disabled={a || b}`) stays a plain boolean condition, not a render branch.
 */
function isConditionalRender(node: ts.BinaryExpression): boolean {
	let current: ts.Node = node;
	while (current.parent && ts.isParenthesizedExpression(current.parent)) {
		current = current.parent;
	}
	const container = current.parent;
	return (
		container !== undefined &&
		ts.isJsxExpression(container) &&
		container.parent !== undefined &&
		(ts.isJsxElement(container.parent) || ts.isJsxFragment(container.parent))
	);
}

/** An `if` that is the `else` branch of another `if` — a flat chain, not nesting. */
function isElseIf(node: ts.IfStatement): boolean {
	const parent = node.parent;
	return Boolean(parent && ts.isIfStatement(parent) && parent.elseStatement === node);
}

/** Structures that cost 1 plus the current nesting depth, and deepen it. */
function isNestingStructure(node: ts.Node): boolean {
	return (
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isSwitchStatement(node) ||
		ts.isCatchClause(node) ||
		ts.isConditionalExpression(node)
	);
}

const DECISION_KINDS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.IfStatement,
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.WhileStatement,
	ts.SyntaxKind.DoStatement,
	ts.SyntaxKind.CaseClause,
	ts.SyntaxKind.ConditionalExpression,
	ts.SyntaxKind.CatchClause,
]);

function parse(filename: string, source: string): ts.SourceFile | null {
	if (!SCRIPT_EXTENSIONS.test(filename)) return null;
	try {
		return ts.createSourceFile(
			filename,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			scriptKindFor(filename),
		);
	} catch {
		return null;
	}
}

/** Per-function results for every function in a source file. */
function measureFunctions(
	sourceFile: ts.SourceFile,
	measure: (functionNode: ts.Node) => number,
): FunctionComplexity[] {
	const results: FunctionComplexity[] = [];
	const visit = (node: ts.Node): void => {
		if (isFunctionLike(node)) {
			results.push({ name: nameOfFunctionLike(node), complexity: measure(node) });
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return results;
}

export function jsxCyclomaticForSource(filename: string, source: string): FunctionComplexity[] {
	const sourceFile = parse(filename, source);
	if (sourceFile === null) return [];

	return measureFunctions(sourceFile, (functionNode) => {
		let complexity = 1;

		const walk = (node: ts.Node): void => {
			if (DECISION_KINDS.has(node.kind)) {
				complexity += 1;
			} else if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
				complexity += 1;
			}

			if (isJsxTag(node)) complexity += 1;
			if (isRenderCallback(node)) complexity += 1;

			// Stop at nested function boundaries: each is measured separately, so
			// counting its decisions or markup here would double-count them.
			if (node !== functionNode && isFunctionLike(node)) return;
			ts.forEachChild(node, walk);
		};

		walk(functionNode);
		return complexity;
	});
}

export function jsxCognitiveForSource(filename: string, source: string): FunctionComplexity[] {
	const sourceFile = parse(filename, source);
	if (sourceFile === null) return [];

	return measureFunctions(sourceFile, (functionNode) => {
		let complexity = 0;

		const walk = (node: ts.Node, depth: number): void => {
			// Nested functions are measured on their own, from depth 0.
			if (node !== functionNode && isFunctionLike(node)) return;

			if (ts.isIfStatement(node)) {
				// An `else if` costs 1 flat; a fresh `if` costs 1 plus its depth.
				const elseIf = isElseIf(node);
				complexity += elseIf ? 1 : 1 + depth;
				const branchDepth = elseIf ? depth : depth + 1;

				walk(node.expression, depth);
				walk(node.thenStatement, branchDepth);

				if (node.elseStatement) {
					if (ts.isIfStatement(node.elseStatement)) {
						// Charged by its own visit as an else-if; keep the same depth.
						walk(node.elseStatement, branchDepth);
					} else {
						complexity += 1; // a plain `else`, no nesting penalty
						walk(node.elseStatement, branchDepth);
					}
				}
				return;
			}

			if (isNestingStructure(node)) {
				complexity += 1 + depth;
				ts.forEachChild(node, (child) => walk(child, depth + 1));
				return;
			}

			// Markup deepens nesting for everything it wraps — children and
			// attributes alike — and structural elements are charged like nested
			// blocks. Leaf elements deepen without charging: what their expressions
			// cost is priced where those expressions branch. Fragments fall through
			// to the plain walk below, rendering no node and adding no depth.
			if (isJsxTag(node)) {
				if (ts.isJsxElement(node) && hasMarkupChildren(node)) complexity += 1 + depth;
				ts.forEachChild(node, (child) => walk(child, depth + 1));
				return;
			}

			// The markup analog of a loop, charged like one.
			if (isRenderCallback(node)) complexity += 1 + depth;

			if (ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind)) {
				// `{cond && <A/>}` forks what gets rendered, so it is charged as a
				// branch of the markup rather than the flat cost of a boolean
				// condition. Operands stay at the same depth: operators do not nest.
				if (startsOperatorRun(node)) {
					complexity += isConditionalRender(node) ? 1 + depth : 1;
				}
			}

			// A labelled break or continue is a jump out of normal flow: +1 flat.
			if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label !== undefined) {
				complexity += 1;
			}

			ts.forEachChild(node, (child) => walk(child, depth));
		};

		walk(functionNode, 0);
		return complexity;
	});
}
