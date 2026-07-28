import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { baselineKey, complexityForFiles, loadOrBuildBaseline } from './baseline.ts';
import { validPin } from './external-ref.ts';

let root: string;

function writeTree(name: string, files: Record<string, string>): string {
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
	root = mkdtempSync(join(tmpdir(), 'baseline-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('validPin', () => {
	it('accepts a well-formed pin', () => {
		expect(validPin({ repo: 'yannbf/mealdrop', ref: 'abc123' })).toEqual({
			repo: 'yannbf/mealdrop',
			ref: 'abc123',
		});
	});

	it('rejects shell-unsafe or malformed values', () => {
		expect(validPin({ repo: 'a b', ref: 'x' })).toBeNull();
		expect(validPin({ repo: 'a/b', ref: '$(id)' })).toBeNull();
		expect(validPin({ repo: 'a/b' })).toBeNull();
		expect(validPin(null)).toBeNull();
	});
});

describe('baselineKey', () => {
	it('escapes separators so the key is a single filename', () => {
		expect(baselineKey({ repo: 'yannbf/mealdrop', ref: 'heads/main' })).toBe(
			'yannbf__mealdrop@heads__main',
		);
	});
});

describe('complexityForFiles', () => {
	it('sums both measures across the given files', () => {
		const dir = writeTree('src', {
			'a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
			'b.ts': 'function b(){ return 1; }\n',
		});
		// a: cyclomatic 2, cognitive 1. b: cyclomatic 1, cognitive 0.
		expect(complexityForFiles(dir, ['a.ts', 'b.ts'])).toEqual({
			cyclomatic: 3,
			cognitive: 1,
			parseFailures: [],
		});
	});

	it('scores a missing file as zero without failing', () => {
		const dir = writeTree('src', { 'a.ts': 'function a(){ return 1; }\n' });
		expect(complexityForFiles(dir, ['a.ts', 'gone.ts'])).toEqual({
			cyclomatic: 1,
			cognitive: 0,
			parseFailures: [],
		});
	});

	it('records a file it cannot parse rather than scoring it zero', () => {
		const dir = writeTree('src', { 'broken.ts': 'function ( { { {\n' });
		expect(complexityForFiles(dir, ['broken.ts']).parseFailures).toEqual(['broken.ts']);
	});

	it('ignores non-script files', () => {
		const dir = writeTree('src', { 'a.css': '.a { color: red; }\n' });
		expect(complexityForFiles(dir, ['a.css'])).toEqual({
			cyclomatic: 0,
			cognitive: 0,
			parseFailures: [],
		});
	});
});

describe('loadOrBuildBaseline', () => {
	const pin = { repo: 'owner/name', ref: 'deadbeef' };

	it('builds and writes a baseline on first call', () => {
		const refDir = writeTree('ref', {
			'src/a.ts': 'function a(x){ if (x) return 1; return 0; }\n',
			'README.md': '# ignored\n',
		});
		const baselineDir = join(root, 'baselines');

		const baseline = loadOrBuildBaseline(baselineDir, refDir, pin);
		expect(baseline.files['src/a.ts']).toEqual({ cyclomatic: 2, cognitive: 1 });
		expect(baseline.files['README.md']).toBeUndefined();
		expect(existsSync(join(baselineDir, 'owner__name@deadbeef.json'))).toBe(true);
	});

	it('reads the cached baseline without touching the ref tree again', () => {
		const baselineDir = join(root, 'baselines');
		mkdirSync(baselineDir, { recursive: true });
		writeFileSync(
			join(baselineDir, 'owner__name@deadbeef.json'),
			JSON.stringify({
				repo: 'owner/name',
				ref: 'deadbeef',
				files: { 'src/a.ts': { cyclomatic: 9, cognitive: 9 } },
			}),
		);

		// A nonexistent ref directory proves the cached copy was used.
		const baseline = loadOrBuildBaseline(baselineDir, join(root, 'no-such-dir'), pin);
		expect(baseline.files['src/a.ts']).toEqual({ cyclomatic: 9, cognitive: 9 });
	});

	it('rebuilds when the pin moves, because the key changes', () => {
		const refDir = writeTree('ref', { 'src/a.ts': 'function a(){ return 1; }\n' });
		const baselineDir = join(root, 'baselines');

		loadOrBuildBaseline(baselineDir, refDir, pin);
		loadOrBuildBaseline(baselineDir, refDir, { repo: 'owner/name', ref: 'cafe' });

		expect(existsSync(join(baselineDir, 'owner__name@deadbeef.json'))).toBe(true);
		expect(existsSync(join(baselineDir, 'owner__name@cafe.json'))).toBe(true);
	});

	it('writes stable, sorted JSON so committed baselines diff cleanly', () => {
		const refDir = writeTree('ref', {
			'src/z.ts': 'function z(){ return 1; }\n',
			'src/a.ts': 'function a(){ return 1; }\n',
		});
		const baselineDir = join(root, 'baselines');
		loadOrBuildBaseline(baselineDir, refDir, pin);

		const written = readFileSync(join(baselineDir, 'owner__name@deadbeef.json'), 'utf8');
		expect(Object.keys(JSON.parse(written).files)).toEqual(['src/a.ts', 'src/z.ts']);
		expect(written.endsWith('\n')).toBe(true);
	});
});
