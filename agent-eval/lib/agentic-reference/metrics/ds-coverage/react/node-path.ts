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
//
// Known shapes this does not chain through:
//
// - JSX reached through a non-JSX node — a `.map()` callback, an attribute value
//   — starts a fresh chain instead of nesting under its container, so a mapped
//   `<li>` reads `List/li[0]`, not `List/ul[0]/li[0]`. Looking through child
//   expressions but not attribute ones is the only correct widening, and telling
//   the two apart is real work; looking through both would let
//   `<div icon={<A/>} />` claim a containment that does not exist. The damage is
//   one link, not a subtree: `List/li[0]/Card[0]` below it still nests.
// - A fragment-rooted set of siblings all index `[0]`, since there is no element
//   container to number them within. They stay distinct by tag, or by `#n`.
// - A class component is named by its nearest named declaration, which is
//   `render` rather than the class.
//
// None of these break uniqueness or relocation-stability — that is the contract
// — they only make a path less descriptive than the format above suggests.
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
	for (let node: ts.Node | undefined = element.parent; node !== undefined; node = node.parent) {
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
	for (let node: JsxNode | undefined = element; node !== undefined; node = containerOf(node)) {
		const container = containerOf(node);
		const index = container === undefined ? 0 : elementChildren(container).indexOf(node);
		segments.unshift(`${elementTag(node)}[${index === -1 ? 0 : index}]`);
	}

	const base = `${declarationName(element)}/${segments.join('/')}`;
	const occurrence = (seen.get(base) ?? 0) + 1;
	seen.set(base, occurrence);
	return occurrence === 1 ? base : `${base}#${occurrence}`;
}
