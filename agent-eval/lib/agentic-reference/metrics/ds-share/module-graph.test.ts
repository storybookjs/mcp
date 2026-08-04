import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildModuleGraph } from './module-graph.ts';

let root: string;

function tree(files: Record<string, string>): string {
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return root;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'ds-share-graph-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('buildModuleGraph', () => {
	it('collects script files and skips tests, stories, and dependencies', () => {
		const dir = tree({
			'src/App.tsx': 'export const App = () => null',
			'src/App.test.tsx': 'export {}',
			'src/App.stories.tsx': 'export {}',
			'src/__tests__/helper.ts': 'export {}',
			'node_modules/x/index.js': 'module.exports = 1',
			'src/logo.svg': '<svg/>',
		});
		const graph = buildModuleGraph(dir);
		expect([...graph.files.keys()]).toEqual(['src/App.tsx']);
	});

	it('records parse failures instead of dropping the file silently', () => {
		const dir = tree({ 'src/broken.ts': 'const = = =' });
		const graph = buildModuleGraph(dir);
		expect(graph.parseFailures).toEqual(['src/broken.ts']);
		expect(graph.files.has('src/broken.ts')).toBe(false);
	});

	it('extracts default, named, renamed, and namespace imports', () => {
		const dir = tree({
			'src/a.tsx': [
				"import styled, { css as c } from 'styled-components'",
				"import * as React from 'react'",
				"import { Button } from './Button'",
			].join('\n'),
			'src/Button.tsx': 'export const Button = () => null',
		});
		const file = buildModuleGraph(dir).files.get('src/a.tsx');
		expect(file?.locals.get('styled')).toEqual({
			type: 'import',
			from: 'styled-components',
			name: 'default',
		});
		expect(file?.locals.get('c')).toEqual({
			type: 'import',
			from: 'styled-components',
			name: 'css',
		});
		expect(file?.locals.get('React')).toEqual({ type: 'namespaceImport', from: 'react' });
		expect(file?.locals.get('Button')).toEqual({
			type: 'import',
			from: './Button',
			name: 'Button',
		});
	});

	it('ignores type-only imports', () => {
		const dir = tree({
			'src/a.ts': ["import type { A } from './b'", "import { type B, C } from './b'"].join('\n'),
			'src/b.ts': 'export const A = 1, B = 2, C = 3',
		});
		const file = buildModuleGraph(dir).files.get('src/a.ts');
		expect(file?.locals.has('A')).toBe(false);
		expect(file?.locals.has('B')).toBe(false);
		expect(file?.locals.get('C')).toEqual({ type: 'import', from: './b', name: 'C' });
	});

	it('extracts local declarations and their export status', () => {
		const dir = tree({
			'src/a.tsx': [
				'export const One = () => null',
				'const Two = () => null',
				'export default function Three() { return null }',
				'export class Four {}',
			].join('\n'),
		});
		const file = buildModuleGraph(dir).files.get('src/a.tsx');
		expect(file?.locals.get('One')?.type).toBe('declaration');
		expect(file?.locals.get('Two')?.type).toBe('declaration');
		expect(file?.exports.get('One')).toEqual({ type: 'local', name: 'One' });
		expect(file?.exports.has('Two')).toBe(false);
		expect(file?.exports.get('default')).toEqual({ type: 'local', name: 'Three' });
		expect(file?.exports.get('Four')).toEqual({ type: 'local', name: 'Four' });
	});

	it('extracts re-exports, star exports, and namespace re-exports', () => {
		const dir = tree({
			'src/index.ts': [
				"export { Button, Input as Field } from './forms'",
				"export * from './Button'",
				"export * as icons from './icons'",
				"export { default as Header } from './Header'",
			].join('\n'),
			'src/forms.tsx': 'export const Button = 1, Input = 2',
			'src/Button.tsx': 'export const Button = () => null',
			'src/icons.tsx': 'export const Star = () => null',
			'src/Header.tsx': 'export default function Header() { return null }',
		});
		const file = buildModuleGraph(dir).files.get('src/index.ts');
		expect(file?.exports.get('Button')).toEqual({
			type: 'reexport',
			from: './forms',
			name: 'Button',
		});
		expect(file?.exports.get('Field')).toEqual({
			type: 'reexport',
			from: './forms',
			name: 'Input',
		});
		expect(file?.exports.get('icons')).toEqual({ type: 'namespaceReexport', from: './icons' });
		expect(file?.exports.get('Header')).toEqual({
			type: 'reexport',
			from: './Header',
			name: 'default',
		});
		expect(file?.starReexports).toEqual(['./Button']);
	});

	it('records export { X } of a local binding and export default <identifier>', () => {
		const dir = tree({
			'src/a.tsx': ['const Card = () => null', 'export { Card }', 'export default Card'].join('\n'),
		});
		const file = buildModuleGraph(dir).files.get('src/a.tsx');
		expect(file?.exports.get('Card')).toEqual({ type: 'local', name: 'Card' });
		expect(file?.exports.get('default')).toEqual({ type: 'local', name: 'Card' });
	});

	it('records module-scope property assignments for compound components', () => {
		const dir = tree({
			'src/Card.tsx': [
				'export const Card = () => null',
				'const Header = () => null',
				'Card.Header = Header',
			].join('\n'),
		});
		const file = buildModuleGraph(dir).files.get('src/Card.tsx');
		expect(file?.propertyAssignments.has('Card.Header')).toBe(true);
	});
});

describe('resolveSpecifier', () => {
	it('resolves relative specifiers with extension and index guessing', () => {
		const dir = tree({
			'src/a.tsx': "import { B } from './b'",
			'src/b.tsx': 'export const B = 1',
			'src/c.tsx': "import { D } from './d'",
			'src/d/index.ts': 'export const D = 1',
		});
		const graph = buildModuleGraph(dir);
		expect(graph.resolveSpecifier('src/a.tsx', './b')).toEqual({ type: 'file', path: 'src/b.tsx' });
		expect(graph.resolveSpecifier('src/c.tsx', './d')).toEqual({
			type: 'file',
			path: 'src/d/index.ts',
		});
	});

	it('resolves ESM-style .js specifiers to their .ts sources', () => {
		const dir = tree({
			'src/a.ts': "import { B } from './b.js'",
			'src/b.ts': 'export const B = 1',
		});
		expect(buildModuleGraph(dir).resolveSpecifier('src/a.ts', './b.js')).toEqual({
			type: 'file',
			path: 'src/b.ts',
		});
	});

	it('resolves parent-directory traversal', () => {
		const dir = tree({
			'src/pages/Home.tsx': "import { Button } from '../components/Button'",
			'src/components/Button.tsx': 'export const Button = 1',
		});
		expect(
			buildModuleGraph(dir).resolveSpecifier('src/pages/Home.tsx', '../components/Button'),
		).toEqual({ type: 'file', path: 'src/components/Button.tsx' });
	});

	it('classifies bare specifiers as packages', () => {
		const dir = tree({ 'src/a.tsx': "import { B } from '@base-ui/react/button'" });
		expect(buildModuleGraph(dir).resolveSpecifier('src/a.tsx', '@base-ui/react/button')).toEqual({
			type: 'package',
			specifier: '@base-ui/react/button',
		});
	});

	it('reports unresolvable relative specifiers as missing', () => {
		const dir = tree({ 'src/a.tsx': "import ladies from './ladies.svg'" });
		expect(buildModuleGraph(dir).resolveSpecifier('src/a.tsx', './ladies.svg')).toEqual({
			type: 'missing',
			specifier: './ladies.svg',
		});
	});
});
