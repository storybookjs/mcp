// Compare the pinned upstream ref against the collected post-run tree.
//
// This is the authoritative changed-file list, and the only one available. The
// harness cannot supply it: `generatedFiles` is a git diff against a commit
// taken before setup() materialises the external repo, so it contains the whole
// application; and `o11y.filesModified` is transcript-derived, so it misses
// every edit made through the shell.
//
// Both sides are comment- and blank-stripped before diffing, so the counts are
// source lines. That rules out `git diff --numstat`, which only sees the raw
// files, hence the LCS diff here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { diffLines } from 'diff';

import { SOURCE_EXTENSIONS, stripToSloc } from './sloc.ts';

export interface SlocDiff {
	added: number;
	removed: number;
	net: number;
}

export interface TreeDiff {
	filesChanged: number;
	/** Workspace-relative paths, sorted. */
	files: string[];
	sloc: SlocDiff;
}

/** Directories never worth walking. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/**
 * Files the harness injects into the collected tree that no agent authored.
 * Counting them would attribute several hundred lines of scaffolding to the run.
 */
export const EXCLUDED_PATHS = new Set([
	'EVAL.ts',
	'EVAL.tsx',
	'PROMPT.md',
	'.npmrc',
	'package.json',
	'package-lock.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'vitest.config.ts',
	'vitest.config.app.ts',
]);

const EXCLUDED_PREFIXES = ['__agent_eval__/', '__metrics__/', '__analysis__/'];

function isExcluded(path: string): boolean {
	if (EXCLUDED_PATHS.has(path)) return true;
	if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
	// Binary assets are UTF-8 corrupted by the copy-out path, so every one of
	// them would otherwise read as changed.
	return !SOURCE_EXTENSIONS.test(path);
}

/** Workspace-relative, POSIX-separated paths of every candidate source file. */
function collectSourceFiles(dir: string): Set<string> {
	const found = new Set<string>();
	if (!existsSync(dir)) return found;

	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
				continue;
			}
			const path = relative(dir, join(current, entry.name)).split(sep).join('/');
			if (!isExcluded(path)) found.add(path);
		}
	};

	walk(dir);
	return found;
}

function readStripped(dir: string, path: string): string {
	const full = join(dir, path);
	if (!existsSync(full)) return '';
	try {
		return stripToSloc(readFileSync(full, 'utf8'), path);
	} catch {
		return '';
	}
}

function countLines(text: string): number {
	return text === '' ? 0 : text.split('\n').length;
}

export function diffTrees(refDir: string, projectDir: string): TreeDiff {
	const candidates = new Set([...collectSourceFiles(refDir), ...collectSourceFiles(projectDir)]);

	const files: string[] = [];
	let added = 0;
	let removed = 0;

	for (const path of candidates) {
		const before = readStripped(refDir, path);
		const after = readStripped(projectDir, path);
		if (before === after) continue;

		let fileAdded = 0;
		let fileRemoved = 0;
		// diffLines needs trailing newlines to treat the last line consistently.
		for (const change of diffLines(
			before === '' ? '' : before + '\n',
			after === '' ? '' : after + '\n',
		)) {
			const lines = countLines(change.value.replace(/\n$/, ''));
			if (change.added) fileAdded += lines;
			else if (change.removed) fileRemoved += lines;
		}

		if (fileAdded === 0 && fileRemoved === 0) continue;
		files.push(path);
		added += fileAdded;
		removed += fileRemoved;
	}

	files.sort();
	return { filesChanged: files.length, files, sloc: { added, removed, net: added - removed } };
}
