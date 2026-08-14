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
		expect(patch.text).toContain('--- a/src/App.tsx');
		expect(patch.text).toContain('+++ b/src/App.tsx');
		expect(patch.text).not.toContain(root);
		// git prints the roots with their leading slash stripped, so the raw path
		// has to be gone under that spelling too, not just the absolute one.
		expect(patch.text).not.toContain(root.replace(/^\/+/, ''));
	});

	it('includes files added by the run', () => {
		const patch = treePatch(
			tree('before', { 'src/App.tsx': 'const a = 1\n' }),
			tree('after', { 'src/App.tsx': 'const a = 1\n', 'src/New.tsx': 'export const New = 1\n' }),
		);
		expect(patch.files).toEqual(['src/New.tsx']);
		expect(patch.text).toContain('new file mode');
		expect(patch.text).toContain('+export const New = 1');
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

	// The cap dropping everything proves nothing about the boundary: the case that
	// matters is a cut that keeps one block and drops the next, whole.
	it('keeps whole blocks that fit and drops the ones that do not', () => {
		const big = 'x'.repeat(4000) + '\n';
		const patch = treePatch(
			tree('before', { 'src/A.tsx': 'const a = 1\n', 'src/B.tsx': 'const b = 1\n' }),
			tree('after', { 'src/A.tsx': 'const a = 2\n', 'src/B.tsx': big }),
			{ maxBytes: 500 },
		);
		expect(patch.files).toEqual(['src/A.tsx']);
		expect(patch.droppedFiles).toBe(1);
		expect(patch.truncated).toBe(true);
		expect(patch.text).toContain('+const a = 2');
		expect(patch.text).not.toContain('src/B.tsx');
		expect(patch.text.split('diff --git').length - 1).toBe(1);
	});
});
