#!/usr/bin/env node
// Offline metrics pass over stored eval runs.
//
// This script is deliberately eval-agnostic. It discovers run directories and
// hands each one to that eval's own hook at evals/<name>/post-analysis.ts;
// which metrics matter, and what they are measured against, is the eval's
// business. Evals without a hook are skipped.
//
// Every metric is a pure function of stored artifacts, so this can be re-run
// over historical results as often as a metric definition changes, without
// spending anything on model calls.
//
// Usage: pnpm results:analyze [--experiment=<name>] [--since=<ISO date>] [--latest]
//
//   --experiment=<name>  only runs under results/<name>/
//   --since=<ISO date>   only runs whose result directory is stamped on or after
//   --latest             only the newest result directory per experiment
//
// The filters exist because results/ accumulates: every invocation adds a new
// timestamped directory, and older ones may come from a different fixture pin.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const EVALS_DIR = join(ROOT, 'evals');

// --- options ---
function parseArgs(argv) {
	const options = { experiment: null, since: null, latest: false };
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		if (flag === '--latest') options.latest = true;
		else if (flag === '--experiment' && value) options.experiment = value;
		else if (flag === '--since' && value) options.since = value;
		else
			throw new Error(
				`Unknown argument "${arg}". See the usage comment in scripts/analyze-results.mjs.`,
			);
	}
	return options;
}

// --- discovery ---
// Layout: results/<experiment>/<model>/<timestamp>/<eval>/run-N/project
function findRuns(dir) {
	if (!existsSync(dir)) return [];
	const runs = [];
	const walk = (current) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(RESULTS_DIR.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0],
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3),
				evalName: parts.at(-2),
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(dir);
	return runs;
}

// Result directories are ISO timestamps with the time's ':' replaced by '-',
// e.g. 2026-07-27T10-43-55.864Z.
function parseTimestamp(timestamp) {
	return new Date(timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}

function selectRuns(runs, options) {
	let selected = runs;
	if (options.experiment) {
		selected = selected.filter((run) => run.experiment === options.experiment);
	}
	if (options.since) {
		const since = new Date(options.since);
		if (Number.isNaN(since.getTime())) {
			throw new Error(`--since must be a parseable date; received "${options.since}"`);
		}
		selected = selected.filter((run) => parseTimestamp(run.timestamp) >= since);
	}
	if (options.latest) {
		const newest = new Map();
		for (const run of selected) {
			const current = newest.get(run.experiment);
			if (current === undefined || run.timestamp > current)
				newest.set(run.experiment, run.timestamp);
		}
		selected = selected.filter((run) => run.timestamp === newest.get(run.experiment));
	}
	return selected;
}

// --- hook loading ---
// Node 24 strips types on import, so a .ts hook loads from this .mjs directly.
const hookCache = new Map();

async function loadHook(evalName) {
	if (hookCache.has(evalName)) return hookCache.get(evalName);

	const path = join(EVALS_DIR, evalName, 'post-analysis.ts');
	let hook = null;
	if (existsSync(path)) {
		hook = await import(pathToFileURL(path).href);
		if (typeof hook.analyzeRun !== 'function') {
			throw new Error(`${evalName}/post-analysis.ts must export an analyzeRun function`);
		}
	}

	hookCache.set(evalName, hook);
	return hook;
}

function readJson(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const runs = selectRuns(findRuns(RESULTS_DIR), options);

	const rows = [];
	const withoutHook = new Set();
	const failed = [];

	for (const run of runs) {
		const hook = await loadHook(run.evalName);
		if (hook === null) {
			withoutHook.add(run.evalName);
			continue;
		}

		try {
			const row = await hook.analyzeRun({
				runDir: run.runDir,
				projectDir: run.projectDir,
				fixtureDir: join(EVALS_DIR, run.evalName),
				experiment: run.experiment,
				model: run.model,
				timestamp: run.timestamp,
				evalName: run.evalName,
				run: run.run,
				result: readJson(join(run.runDir, 'result.json')),
				readTranscript: () => {
					const transcript = readJson(join(run.runDir, 'transcript.json'));
					if (transcript === null) throw new Error('transcript.json missing or unreadable');
					return transcript;
				},
			});
			if (row) rows.push({ ...row, __eval: run.evalName });
		} catch (error) {
			// One broken run must not cost us the others.
			failed.push(`${run.evalName} run-${run.run}: ${error.message}`);
		}
	}

	if (withoutHook.size > 0) {
		console.log(`Skipped evals with no post-analysis.ts: ${[...withoutHook].join(', ')}`);
	}
	for (const message of failed) console.error(`Analysis failed for ${message}`);

	if (rows.length === 0) {
		console.log('No analysable runs found under results/.');
		return;
	}

	rows.sort(
		(a, b) =>
			String(a.experiment).localeCompare(String(b.experiment)) ||
			String(a.timestamp).localeCompare(String(b.timestamp)) ||
			a.run - b.run,
	);

	// `__eval` is internal routing state, stripped before anything sees a record.
	const strip = (row) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__eval'));

	// Aggregation and rendering belong to the eval; fall back to a generic table.
	const byEval = new Map();
	for (const row of rows) {
		const list = byEval.get(row.__eval) ?? [];
		list.push(row);
		byEval.set(row.__eval, list);
	}

	const allSummaries = [];
	for (const [evalName, evalRows] of byEval) {
		const hook = await loadHook(evalName);
		const bare = evalRows.map(strip);
		const summary = typeof hook.summarize === 'function' ? hook.summarize(bare) : [];
		allSummaries.push(...summary);

		if (typeof hook.renderTables === 'function') hook.renderTables(bare, summary);
		else console.table(bare.map(({ experiment, run, status }) => ({ experiment, run, status })));
	}

	writeFileSync(
		join(RESULTS_DIR, 'agentic-ref-analysis.json'),
		JSON.stringify({ runs: rows.map(strip), summary: allSummaries }, null, 2) + '\n',
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
