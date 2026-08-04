// React declaration analysis: what a local declaration ultimately renders.
//
// This is the framework-specific half of the identification layer. Everything
// here embodies one rule from the metric's definition — classification always
// resolves to the *target* component:
//
// - `styled.div` is `div`; `styled(X)` is X — through `.attrs`/`.withConfig`
//   chains, generic type arguments, and both the template and call forms;
//   `.withComponent(Y)` replaces the target with Y
// - `memo(X)` and `forwardRef(fn)` are transparent
// - `lazy(() => import('./x'))` is x's default export
// - a wrapper that *merely subsets* a DS component counts as that DS
//   component. "Merely subsets" is read as: a single unconditional return of
//   one JSX element that forwards the rest of its props (a spread attribute)
//   to a root resolving to a DS component — the `App.Button` hard-coding
//   `size=small` shape. A component that hard-codes its whole subtree under a
//   DS root is a composition, not a subset, and stays `local`; reaching
//   non-DS targets is also out, because that would dissolve every page into
//   its root `div`.
//
// Identifier lookups are scope-aware: parameters and function-scope
// declarations shadow module scope, so a component arriving through props or
// a hook result is reported `unresolved` rather than resolved to whatever
// module-level import shares its name.
import ts from 'typescript';

import type { ModuleFile } from '../module-graph.ts';
import type { DeclarationAnalyzer, IdentityResolver, Resolution } from '../types.ts';

function unresolved(reason: string): Resolution {
	return { category: 'unresolved', reason };
}

/** Strip parentheses, casts, and non-null assertions. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

/** Whether a binding name (identifier or destructuring pattern) binds `name`. */
function bindingNameBinds(binding: ts.BindingName, name: string): boolean {
	if (ts.isIdentifier(binding)) return binding.text === name;
	return binding.elements.some(
		(element) => ts.isBindingElement(element) && bindingNameBinds(element.name, name),
	);
}

function declarationsOf(node: ts.Node): readonly ts.VariableDeclaration[] | null {
	if (ts.isVariableStatement(node)) return node.declarationList.declarations;
	if (
		(ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node)) &&
		node.initializer !== undefined &&
		ts.isVariableDeclarationList(node.initializer)
	) {
		return node.initializer.declarations;
	}
	return null;
}

/**
 * Resolve `name` as the innermost binding visible at `site`. Parameters and
 * destructured bindings shadow module scope but have no statically knowable
 * value, so they resolve to `unresolved`; sibling function-scope declarations
 * are analyzed like any other declaration.
 */
export function resolveScopedName(
	file: ModuleFile,
	site: ts.Node,
	name: string,
	resolver: IdentityResolver,
): Resolution {
	for (let scope: ts.Node | undefined = site.parent; scope !== undefined; scope = scope.parent) {
		if (ts.isFunctionLike(scope)) {
			const parameters = (scope as ts.SignatureDeclaration).parameters ?? [];
			for (const parameter of parameters) {
				if (bindingNameBinds(parameter.name, name)) {
					return unresolved(`'${name}' is a parameter in ${file.path}`);
				}
			}
		}
		const statements = ts.isBlock(scope) ? scope.statements : null;
		for (const statement of statements ?? []) {
			for (const declaration of declarationsOf(statement) ?? []) {
				if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
					return resolver.analyzeDeclaration(file, declaration, name);
				}
				if (!ts.isIdentifier(declaration.name) && bindingNameBinds(declaration.name, name)) {
					return unresolved(`'${name}' is destructured in a local scope in ${file.path}`);
				}
			}
			if (
				(ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
				statement.name?.text === name
			) {
				return resolver.analyzeDeclaration(file, statement, name);
			}
		}
		if (ts.isForOfStatement(scope) || ts.isForInStatement(scope) || ts.isForStatement(scope)) {
			for (const declaration of declarationsOf(scope) ?? []) {
				if (bindingNameBinds(declaration.name, name)) {
					return unresolved(`'${name}' is a loop binding in ${file.path}`);
				}
			}
		}
	}
	return resolver.resolveLocal(file, name);
}

/** Packages whose default export is a styled-component factory. */
const STYLED_MODULES = new Set(['styled-components', '@emotion/styled']);

/**
 * Whether a resolved binding is a styled factory. A DS is welcome to export
 * its own `styled` (the MUI shape), so DS-package exports qualify too.
 */
function isStyledFactory(resolution: Resolution): boolean {
	if (resolution.category !== 'external' && resolution.category !== 'ds') return false;
	if (resolution.name === 'styled') return true;
	return resolution.name === 'default' && STYLED_MODULES.has(resolution.module);
}

function isReactHelper(resolution: Resolution, helper: string): boolean {
	return (
		resolution.category === 'external' &&
		resolution.module === 'react' &&
		resolution.name === helper
	);
}

type StyledTarget =
	| { kind: 'intrinsic'; tag: string }
	| { kind: 'expression'; node: ts.Expression };

/**
 * If `expression` is a styled-component construction, its target: the
 * intrinsic for `styled.div`, the wrapped expression for `styled(X)` — looking
 * through `.attrs(...)`/`.withConfig(...)` chains and both invocation forms
 * (`styled(X)`tpl``  and `styled(X)<Props>(fn)`). `.withComponent(Y)` swaps
 * the target for Y.
 */
function styledTargetOf(
	file: ModuleFile,
	expression: ts.Expression,
	resolver: IdentityResolver,
): StyledTarget | null {
	let current: ts.Expression = expression;
	for (;;) {
		if (ts.isTaggedTemplateExpression(current)) {
			current = current.tag;
			continue;
		}
		if (ts.isCallExpression(current)) {
			const callee = unwrapExpression(current.expression);
			if (
				ts.isPropertyAccessExpression(callee) &&
				callee.name.text === 'withComponent' &&
				styledTargetOf(file, callee.expression, resolver) !== null
			) {
				const replacement = current.arguments[0];
				if (replacement === undefined) return null;
				if (ts.isStringLiteral(replacement)) return { kind: 'intrinsic', tag: replacement.text };
				return { kind: 'expression', node: replacement };
			}
			if (
				ts.isIdentifier(callee) &&
				isStyledFactory(resolveScopedName(file, callee, callee.text, resolver))
			) {
				const target = current.arguments[0];
				return target ? { kind: 'expression', node: target } : null;
			}
			current = callee;
			continue;
		}
		if (ts.isPropertyAccessExpression(current)) {
			const base = unwrapExpression(current.expression);
			if (
				ts.isIdentifier(base) &&
				isStyledFactory(resolveScopedName(file, base, base.text, resolver))
			) {
				// `styled.div` — chain methods (`styled.div.attrs`) arrive here too,
				// but then `base` is `styled.div`, not `styled`, and recursion below
				// reaches it.
				return { kind: 'intrinsic', tag: current.name.text };
			}
			current = base;
			continue;
		}
		return null;
	}
}

/** The `X` of `lazy(() => import('./x'))`, or null. */
function lazyImportSpecifier(argument: ts.Expression | undefined): string | null {
	if (argument === undefined) return null;
	const body =
		ts.isArrowFunction(argument) && ts.isExpression(argument.body)
			? unwrapExpression(argument.body)
			: null;
	if (
		body !== null &&
		ts.isCallExpression(body) &&
		body.expression.kind === ts.SyntaxKind.ImportKeyword &&
		body.arguments[0] !== undefined &&
		ts.isStringLiteral(body.arguments[0])
	) {
		return body.arguments[0].text;
	}
	return null;
}

/**
 * Every returned value of a function, ignoring returns of nested functions
 * (those are someone else's render). A bare `return;` appears as null: a
 * guard clause makes the render conditional, which disqualifies the
 * subsetting-wrapper reading just like a second returned element would.
 */
function returnedExpressions(
	fn: ts.SignatureDeclaration & { body?: ts.Node },
): Array<ts.Expression | null> {
	const body = fn.body;
	if (body === undefined) return [];
	if (ts.isExpression(body as ts.Node)) return [unwrapExpression(body as ts.Expression)];

	const returns: Array<ts.Expression | null> = [];
	const walk = (node: ts.Node): void => {
		if (ts.isReturnStatement(node)) {
			returns.push(node.expression ? unwrapExpression(node.expression) : null);
			return;
		}
		if (ts.isFunctionLike(node)) return;
		ts.forEachChild(node, walk);
	};
	ts.forEachChild(body, walk);
	return returns;
}

/** Resolve a JSX tag name to what it is. Shared by census and wrapper analysis. */
export function resolveJsxTag(
	file: ModuleFile,
	tag: ts.JsxTagNameExpression,
	resolver: IdentityResolver,
): Resolution {
	if (ts.isIdentifier(tag)) {
		// The JSX rule: lowercase tags are host elements, everything else is a
		// component reference into scope.
		if (/^[a-z]/.test(tag.text)) return { category: 'host', tag: tag.text };
		return resolveScopedName(file, tag, tag.text, resolver);
	}
	if (ts.isPropertyAccessExpression(tag)) {
		const properties: string[] = [];
		let base: ts.Node = tag;
		while (ts.isPropertyAccessExpression(base)) {
			properties.unshift(base.name.text);
			base = base.expression;
		}
		if (!ts.isIdentifier(base)) return unresolved(`unresolvable tag base '${tag.getText()}'`);
		let resolution = resolveScopedName(file, base, base.text, resolver);
		for (const property of properties) {
			resolution = resolver.memberOf(resolution, property);
		}
		return resolution;
	}
	// `<this.X>` (legacy class idiom) and namespaced tags (`<svg:rect>`, host
	// markup by construction).
	if (tag.kind === ts.SyntaxKind.ThisKeyword) return unresolved('tag on `this`');
	return { category: 'host', tag: tag.getText() };
}

function analyzeFunctionComponent(
	file: ModuleFile,
	fn: ts.SignatureDeclaration & { body?: ts.Node },
	name: string,
	resolver: IdentityResolver,
): Resolution {
	const returns = returnedExpressions(fn);
	const root = returns.length === 1 ? returns[0] : undefined;
	if (root != null && (ts.isJsxElement(root) || ts.isJsxSelfClosingElement(root))) {
		const opening = ts.isJsxElement(root) ? root.openingElement : root;
		// The spread is what separates "the DS component with some props fixed"
		// from "a component of our own that happens to sit on a DS root".
		const forwardsProps = opening.attributes.properties.some(ts.isJsxSpreadAttribute);
		if (forwardsProps) {
			const target = resolveJsxTag(file, opening.tagName, resolver);
			if (target.category === 'ds') return target;
		}
	}
	return { category: 'local', module: file.path, name };
}

function analyzeExpression(
	file: ModuleFile,
	expression: ts.Expression,
	name: string,
	resolver: IdentityResolver,
): Resolution {
	const expr = unwrapExpression(expression);

	if (ts.isIdentifier(expr)) return resolveScopedName(file, expr, expr.text, resolver);

	if (ts.isPropertyAccessExpression(expr)) {
		const styled = styledTargetOf(file, expr, resolver);
		if (styled !== null) return resolveStyledTarget(file, styled, name, resolver);
		if (!ts.isIdentifier(expr.name)) return unresolved(`unanalyzable member '${expr.getText()}'`);
		return resolver.memberOf(
			analyzeExpression(file, expr.expression, name, resolver),
			expr.name.text,
		);
	}

	if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
		return analyzeFunctionComponent(file, expr, name, resolver);
	}

	if (ts.isObjectLiteralExpression(expr)) return { category: 'object', file, node: expr };

	if (ts.isCallExpression(expr) || ts.isTaggedTemplateExpression(expr)) {
		const styled = styledTargetOf(file, expr, resolver);
		if (styled !== null) return resolveStyledTarget(file, styled, name, resolver);

		if (ts.isCallExpression(expr)) {
			const callee = unwrapExpression(expr.expression);
			const calleeResolution = ts.isIdentifier(callee)
				? resolveScopedName(file, callee, callee.text, resolver)
				: ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
					? resolver.memberOf(
							resolveScopedName(file, callee.expression, callee.expression.text, resolver),
							callee.name.text,
						)
					: null;

			if (calleeResolution !== null) {
				if (
					isReactHelper(calleeResolution, 'memo') ||
					isReactHelper(calleeResolution, 'forwardRef')
				) {
					const wrapped = expr.arguments[0];
					if (wrapped === undefined) return unresolved(`${name}: empty memo/forwardRef`);
					return analyzeExpression(file, wrapped, name, resolver);
				}
				if (isReactHelper(calleeResolution, 'lazy')) {
					const specifier = lazyImportSpecifier(expr.arguments[0]);
					if (specifier !== null) return resolver.resolveModule(file, specifier, 'default');
					return unresolved(`${name}: dynamic lazy()`);
				}
				// `createGlobalStyle(...)` builds a style-injecting component from a
				// css template, not from a wrapped component — unlike an HOC call,
				// there is no hidden target to find, so the call form resolves like
				// the tagged-template form below.
				if (
					calleeResolution.category === 'external' &&
					calleeResolution.name === 'createGlobalStyle'
				) {
					return calleeResolution;
				}
			}
		}

		// A tagged template over a package import (`createGlobalStyle`, a css-in-js
		// `keyframes` cousin, an i18n tag) hides no target component the way an
		// HOC call can, so the result *is* the package's construct.
		if (ts.isTaggedTemplateExpression(expr)) {
			const tag = unwrapExpression(expr.tag);
			const tagResolution = ts.isIdentifier(tag)
				? resolveScopedName(file, tag, tag.text, resolver)
				: null;
			if (tagResolution?.category === 'ds' || tagResolution?.category === 'external') {
				return tagResolution;
			}
		}
		// Any other factory (`connect(...)`, `withRouter(X)`, custom HOCs) is a
		// transformation this analyzer does not understand; guessing would
		// misattribute, so it is reported, not classified.
		return unresolved(`unrecognized call binding '${name}' in ${file.path}`);
	}

	if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) {
		return unresolved(`JSX value bound to '${name}' used as a tag`);
	}

	if (ts.isConditionalExpression(expr)) {
		return unresolved(`conditional binding '${name}' in ${file.path}`);
	}

	return unresolved(`unanalyzable declaration '${name}' in ${file.path}`);
}

function resolveStyledTarget(
	file: ModuleFile,
	target: StyledTarget,
	name: string,
	resolver: IdentityResolver,
): Resolution {
	if (target.kind === 'intrinsic') return { category: 'host', tag: target.tag };
	return analyzeExpression(file, target.node, name, resolver);
}

/** The React `DeclarationAnalyzer` plugged into the identification layer. */
export const analyzeReactDeclaration: DeclarationAnalyzer = (file, node, name, resolver) => {
	if (ts.isVariableDeclaration(node)) {
		if (node.initializer === undefined) return unresolved(`'${name}' has no initializer`);
		return analyzeExpression(file, node.initializer, name, resolver);
	}
	if (ts.isFunctionDeclaration(node)) {
		return analyzeFunctionComponent(file, node, name, resolver);
	}
	if (ts.isClassDeclaration(node)) {
		// Class components exist but subsetting wrappers written as classes are
		// vanishingly rare; a class is its own component.
		return { category: 'local', module: file.path, name };
	}
	if (ts.isExpression(node)) return analyzeExpression(file, node, name, resolver);
	return unresolved(`unanalyzable declaration '${name}' in ${file.path}`);
};
