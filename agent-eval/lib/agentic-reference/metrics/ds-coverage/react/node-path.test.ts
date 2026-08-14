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
