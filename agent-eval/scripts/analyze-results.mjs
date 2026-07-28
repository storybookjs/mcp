#!/usr/bin/env node
// Offline metrics pass for agentic-reference runs (barebone).
//
// For each run it compares a pre-run baseline (the ref) against the post-run
// tree (the collected post-agent project/) and writes the diff to analysis.json.
//
// Current metric: how many `Button` imports the source contains — a footer that
// reuses the design-system Button should have one more after the run than the
// ref. Heavier analyzers (app tests, LLM judges) are left as stubs.
//
// Usage: pnpm results:analyze
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const EVALS_DIR = join(ROOT, 'evals');
const REF_CACHE_DIR = join(ROOT, '.eval-cache', 'refs');

const SOURCE_FILE = /\.[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next']);
// An import statement that pulls in a `Button` binding.
const BUTTON_IMPORT = /import\s+[^;]*?\bButton\b[^;]*?from\s+['"][^'"]+['"]/g;

// --- metric: count Button imports across a source tree ---
function countButtonImports(dir) {
	let count = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) count += countButtonImports(path);
		} else if (SOURCE_FILE.test(entry.name)) {
			count += (readFileSync(path, 'utf8').match(BUTTON_IMPORT) ?? []).length;
		}
	}
	return count;
}

// --- discovery ---
function findRuns(dir) {
	if (!existsSync(dir)) return [];
	const runs = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(current, entry.name);
			if (/^run-\d+$/.test(entry.name) && existsSync(join(path, 'project'))) {
				runs.push({
					runDir: path,
					projectDir: join(path, 'project'),
					evalName: current.split('/').at(-1),
					experiment: path.slice(RESULTS_DIR.length + 1).split('/')[0],
				});
			} else {
				walk(path);
			}
		}
	};
	walk(dir);
	return runs;
}

function readMarker(evalName) {
	const manifest = join(EVALS_DIR, evalName, 'package.json');
	if (!existsSync(manifest)) return null;
	const marker = JSON.parse(readFileSync(manifest, 'utf8'))?.evals?.externalRepo;
	return marker?.repo && marker?.ref ? marker : null;
}

// --- pre-run baseline: fetch the ref source once per sha (no install) ---
const refCache = new Map();
function prepareRef(repo, ref) {
	const slug = `${repo.replace(/\//g, '__')}@${ref}`;
	if (refCache.has(slug)) return refCache.get(slug);
	const dir = join(REF_CACHE_DIR, slug);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
		execFileSync(
			'bash',
			['-lc', `set -euo pipefail; curl -fsSL 'https://codeload.github.com/${repo}/tar.gz/${ref}' | tar xz --strip-components=1`],
			{ cwd: dir },
		);
	}
	refCache.set(slug, dir);
	return dir;
}

// --- per-run analysis ---
function analyzeRun(run) {
	const marker = readMarker(run.evalName);
	if (!marker) return null;

	const before = countButtonImports(prepareRef(marker.repo, marker.ref));
	const after = countButtonImports(run.projectDir);

	const row = {
		experiment: run.experiment,
		eval: run.evalName,
		ref: `${marker.repo}@${marker.ref.slice(0, 12)}`,
		buttonImports: { before, after, delta: after - before },
		appTests: null, // TODO: offline app-test suite (prepare + install + run)
		judged: null, // TODO: LLM-judge columns
	};
	writeFileSync(join(run.runDir, 'analysis.json'), JSON.stringify(row, null, 2) + '\n');
	return row;
}

function main() {
	const runs = findRuns(RESULTS_DIR);
	const rows = [];
	for (const run of runs) {
		const row = analyzeRun(run);
		if (row) rows.push(row);
	}
	if (rows.length === 0) {
		console.log('No external-repo runs found under results/.');
		return;
	}

	writeFileSync(join(RESULTS_DIR, 'agentic-ref-analysis.json'), JSON.stringify(rows, null, 2) + '\n');
	console.table(
		rows.map((r) => ({
			experiment: r.experiment.replace(/^agentic-ref-/, ''),
			before: r.buttonImports.before,
			after: r.buttonImports.after,
			delta: r.buttonImports.delta,
		})),
	);
}

main();
