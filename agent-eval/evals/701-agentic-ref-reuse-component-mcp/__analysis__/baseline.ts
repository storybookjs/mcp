// Precomputed whole-repo complexity for a pinned ref, keyed by repo@sha.
//
// The "before" side of a complexity diff only changes when the pin moves, so
// parsing ~200 files on every run of every experiment is wasted work. Keying by
// sha means a moved pin misses the cache rather than silently reusing numbers
// from a different tree.
//
// Baselines live under evals/ rather than .eval-cache/ because .eval-cache/ is
// gitignored; committing them means CI never recomputes and a reviewer can see
// the baseline change when a pin moves.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { cognitiveForSource } from './cognitive.ts';
import { complexityForSource } from './cyclomatic.ts';
import type { ExternalRepoPin } from './external-ref.ts';
import { pinSlug } from './external-ref.ts';
import { isExcludedPath, SCRIPT_EXTENSIONS, SKIP_DIRS } from './paths.ts';
import { hasParseErrors } from './sloc.ts';

export interface FileComplexity {
	cyclomatic: number;
	cognitive: number;
}

export interface Baseline {
	repo: string;
	ref: string;
	/** Workspace-relative path to that file's summed complexity. */
	files: Record<string, FileComplexity>;
}

export interface ComplexityTotals extends FileComplexity {
	/** Files that could not be parsed, so a real 0 is distinguishable from a miss. */
	parseFailures: string[];
}

export function baselineKey(pin: ExternalRepoPin): string {
	return pinSlug(pin);
}

function sum(entries: Array<{ complexity: number }>): number {
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
		cyclomatic: sum(complexityForSource(path, source)),
		cognitive: sum(cognitiveForSource(path, source)),
	};
}

/** Summed complexity across a specific set of files in a tree. */
export function complexityForFiles(dir: string, files: string[]): ComplexityTotals {
	let cyclomatic = 0;
	let cognitive = 0;
	const parseFailures: string[] = [];

	for (const path of files) {
		const score = scoreFile(dir, path);
		if (score === null) continue;
		if (score === 'unparseable') {
			parseFailures.push(path);
			continue;
		}
		cyclomatic += score.cyclomatic;
		cognitive += score.cognitive;
	}

	return { cyclomatic, cognitive, parseFailures };
}

function collectScriptFiles(dir: string): string[] {
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
	return found.sort();
}

export function loadOrBuildBaseline(
	baselineDir: string,
	refDir: string,
	pin: ExternalRepoPin,
): Baseline {
	const path = join(baselineDir, `${baselineKey(pin)}.json`);

	if (existsSync(path)) {
		try {
			return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
		} catch {
			// A truncated baseline is worse than none; fall through and rebuild.
		}
	}

	const files: Record<string, FileComplexity> = {};
	// Sorted so the committed JSON diffs cleanly when a pin moves.
	for (const file of collectScriptFiles(refDir)) {
		const score = scoreFile(refDir, file);
		if (score === null || score === 'unparseable') continue;
		files[file] = score;
	}

	const baseline: Baseline = { repo: pin.repo, ref: pin.ref, files };
	mkdirSync(baselineDir, { recursive: true });
	writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n');
	return baseline;
}
