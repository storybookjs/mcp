// Cyclomatic complexity per function. Ported from storybookjs/storybook#35141
// (scripts/sustainability/assess-mvc/cost-benefit/utils/cyclomatic.ts). The two
// repositories are expected to merge later, at which point this and its
// original should be deduplicated.
//
// Two defects were fixed on port: the original parsed every file as TSX, so
// generic arrows in .ts mis-parsed as JSX; and it omitted constructors and
// accessors from its notion of a function, so their bodies were misattributed.
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

function memberName(node: ts.Node, fallback: string): string {
	const named = node as { name?: ts.Node };
	const raw =
		named.name && (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name))
			? named.name.text
			: fallback;
	const className = enclosingClassName(node);
	return className ? `${className}.${raw}` : raw;
}

function nameOfFunctionLike(node: ts.Node): string | undefined {
	if (ts.isFunctionDeclaration(node)) return node.name?.text;
	if (ts.isConstructorDeclaration(node)) {
		const className = enclosingClassName(node);
		return className ? `${className}.constructor` : 'constructor';
	}
	if (ts.isMethodDeclaration(node)) return memberName(node, 'method');
	if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
		return memberName(node, 'accessor');
	}
	if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
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
		if (parent && ts.isPropertyDeclaration(parent)) return memberName(parent, 'property');
	}
	return undefined;
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

const SHORT_CIRCUIT_OPERATORS = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.AmpersandAmpersandToken,
	ts.SyntaxKind.BarBarToken,
	ts.SyntaxKind.QuestionQuestionToken,
]);

export function complexityForSource(filename: string, source: string): FunctionComplexity[] {
	if (!SCRIPT_EXTENSIONS.test(filename)) return [];

	let sourceFile: ts.SourceFile;
	try {
		sourceFile = ts.createSourceFile(
			filename,
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			scriptKindFor(filename),
		);
	} catch {
		return [];
	}

	const results: FunctionComplexity[] = [];

	const measure = (functionNode: ts.Node, name: string): void => {
		let complexity = 1;

		const walk = (node: ts.Node): void => {
			if (DECISION_KINDS.has(node.kind)) {
				complexity += 1;
			} else if (
				ts.isBinaryExpression(node) &&
				SHORT_CIRCUIT_OPERATORS.has(node.operatorToken.kind)
			) {
				complexity += 1;
			}

			// Stop at nested function boundaries: each is measured separately, so
			// counting its decisions here would double-count them.
			if (node !== functionNode && isFunctionLike(node)) return;
			ts.forEachChild(node, walk);
		};

		walk(functionNode);
		results.push({ name, complexity });
	};

	const visit = (node: ts.Node): void => {
		if (isFunctionLike(node)) measure(node, nameOfFunctionLike(node) ?? '<anonymous>');
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return results;
}
