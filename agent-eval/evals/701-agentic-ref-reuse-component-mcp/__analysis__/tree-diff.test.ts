import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diffTrees } from './tree-diff.ts';

let root: string;

function tree(name: string, files: Record<string, string>): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
	}
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'tree-diff-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('diffTrees', () => {
	it('reports no change for identical trees', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', { 'src/a.ts': 'const a = 1\n' });
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('counts added and removed lines in a modified file', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\nconst b = 2\n' });
		const after = tree('after', { 'src/a.ts': 'const a = 1\nconst c = 3\nconst d = 4\n' });
		const result = diffTrees(before, after);
		expect(result.files).toEqual(['src/a.ts']);
		expect(result.sloc).toEqual({ added: 2, removed: 1, net: 1 });
	});

	it('counts a new file as all-added', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', {
			'src/a.ts': 'const a = 1\n',
			'src/b.ts': 'const b = 1\nconst c = 2\n',
		});
		expect(diffTrees(before, after).sloc).toEqual({ added: 2, removed: 0, net: 2 });
	});

	it('counts a deleted file as all-removed', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\nconst b = 2\n' });
		const after = tree('after', {});
		expect(diffTrees(before, after).sloc).toEqual({ added: 0, removed: 2, net: -2 });
	});

	it('ignores comment and blank-line churn', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', { 'src/a.ts': '// explain\n\nconst a = 1\n\n' });
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('ignores non-source files', () => {
		const before = tree('before', { 'README.md': 'old\n' });
		const after = tree('after', { 'README.md': 'new\nlines\n' });
		expect(diffTrees(before, after).filesChanged).toBe(0);
	});

	it('ignores harness-injected paths', () => {
		const before = tree('before', { 'src/a.ts': 'const a = 1\n' });
		const after = tree('after', {
			'src/a.ts': 'const a = 1\n',
			'EVAL.ts': 'test("x", () => {})\n',
			'__agent_eval__/test-utils.ts': 'export const x = 1\n',
			'__metrics__/mcp-usage.json': '{}\n',
			'vitest.config.app.ts': 'export default {}\n',
		});
		expect(diffTrees(before, after)).toEqual({
			filesChanged: 0,
			files: [],
			sloc: { added: 0, removed: 0, net: 0 },
		});
	});

	it('ignores node_modules and .git', () => {
		const before = tree('before', {});
		const after = tree('after', {
			'node_modules/pkg/index.js': 'module.exports = 1\n',
			'.git/config': 'x\n',
		});
		expect(diffTrees(before, after).filesChanged).toBe(0);
	});

	it('returns sorted, workspace-relative paths', () => {
		const before = tree('before', {});
		const after = tree('after', { 'src/z.ts': 'const z = 1\n', 'src/a.ts': 'const a = 1\n' });
		expect(diffTrees(before, after).files).toEqual(['src/a.ts', 'src/z.ts']);
	});

	it('tolerates a missing ref directory', () => {
		const after = tree('after', { 'src/a.ts': 'const a = 1\n' });
		expect(diffTrees(join(root, 'nope'), after).sloc.added).toBe(1);
	});

	it('counts a blank added line as physical churn but not as SLoC', () => {
		// The captured run's real change adds 10 physical lines, one of them blank,
		// so the metric reports 9. Pinned here because the two figures are easy to
		// confuse: `diff -u` shows 10, this shows 9, and both are correct.
		const before = tree('before', { 'src/a.ts': 'const a = 1\nconst b = 2\n' });
		const after = tree('after', { 'src/a.ts': 'const a = 1\n\nconst x = 9\nconst b = 2\n' });
		expect(diffTrees(before, after).sloc).toEqual({ added: 1, removed: 0, net: 1 });
	});
});
