// Cyclomatic and cognitive complexity over a source tree.
//
// Measuring and totalling are separate steps, so both sides of a delta can be
// measured the same way and added up later:
// - `complexityForFiles` scores a named subset: the files the agent touched
// - `buildTreeComplexity` scores a whole tree, which is what a baseline holds
// - `sumComplexities` folds either one's per-file scores into a single total
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { cognitiveForSource } from './complexity-cognitive.ts';
import { complexityForSource } from './complexity-cyclomatic.ts';
import { isExcludedPath, SCRIPT_EXTENSIONS, SKIP_DIRS } from '../tree/paths.ts';
import { hasParseErrors } from './sloc.ts';

export interface FileComplexity {
	cyclomatic: number;
	cognitive: number;
}

export interface ComplexityResult {
	/** Per-file scores, keyed by workspace-relative path. */
	files: Record<string, FileComplexity>;
	/** Files that could not be parsed, so a real 0 is distinguishable from a miss. */
	parseFailures: string[];
}

function sumNodes(entries: Array<{ complexity: number }>): number {
	return entries.reduce((total, entry) => total + entry.complexity, 0);
}

/**
 * Summed complexity for one file, or 'unparseable' when TypeScript reported
 * syntax errors. Distinguishing the two matters: a file the walker gave up on
 * would otherwise contribute 0 and read as "no complexity here", quietly
 * understating a delta.
 */
function scoreFile(dir: string, path: string): FileComplexity | 'unparseable' | null {
	const full = join(dir, path);
	if (!existsSync(full) || !SCRIPT_EXTENSIONS.test(path) || isExcludedPath(path)) return null;

	let source: string;
	try {
		source = readFileSync(full, 'utf8');
	} catch {
		return null;
	}

	if (hasParseErrors(path, source)) return 'unparseable';

	return {
		cyclomatic: sumNodes(complexityForSource(path, source)),
		cognitive: sumNodes(cognitiveForSource(path, source)),
	};
}

function collectAllCodeFiles(dir: string): string[] {
	const found: string[] = [];
	if (!existsSync(dir)) return found;

	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
				continue;
			}
			const path = relative(dir, join(current, entry.name)).split(sep).join('/');
			if (SCRIPT_EXTENSIONS.test(path) && !isExcludedPath(path)) found.push(path);
		}
	};

	walk(dir);

	// Sorted so the committed baseline diffs cleanly when a pin moves.
	return found.sort();
}

/** Total complexity across already-scored files. */
export function sumComplexities(files: Record<string, FileComplexity>): FileComplexity {
	return Object.values(files).reduce(
		(totals, score) => ({
			cyclomatic: totals.cyclomatic + score.cyclomatic,
			cognitive: totals.cognitive + score.cognitive,
		}),
		{ cyclomatic: 0, cognitive: 0 },
	);
}

/** Per-file complexity across a specific set of files in a tree. */
export function complexityForFiles(dir: string, paths: string[]): ComplexityResult {
	const files: Record<string, FileComplexity> = {};
	const parseFailures: string[] = [];

	for (const path of paths) {
		const score = scoreFile(dir, path);
		if (score === null) continue;
		if (score === 'unparseable') {
			parseFailures.push(path);
			continue;
		}
		files[path] = score;
	}

	return { files, parseFailures };
}

/** Per-file complexity across every code file in a tree. */
export function complexityForTree(dir: string): ComplexityResult {
	return complexityForFiles(dir, collectAllCodeFiles(dir));
}
