#!/usr/bin/env node
// Offline metrics pass for agentic-reference runs.
//
// Each repetition of an experiment (AGENTIC_REF_RUNS) lands in its own run-N
// directory. This script visits every one, compares the pre-run baseline (the
// pinned ref) against the post-run tree (the collected post-agent project/),
// folds in the signals the harness already recorded in result.json (status,
// token usage, MCP tool calls), and reports both the per-run rows and an
// aggregate across the repetitions.
//
// Source metric: how many `Button` imports the source contains — a footer that
// reuses the design-system Button should have one more after the run than the
// ref. Heavier analyzers (offline app tests, LLM judges) are left as stubs.
//
// Usage: pnpm results:analyze [--experiment=<name>] [--since=<ISO date>] [--latest]
//
//   --experiment=<name>  only runs under results/<name>/
//   --since=<ISO date>   only runs whose result directory is stamped on or after
//   --latest             only the newest result directory per experiment
//
// The filters exist because results/ accumulates: every invocation adds a new
// timestamped directory, and older ones may come from a different fixture pin.
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
			[
				'-lc',
				`set -euo pipefail; curl -fsSL 'https://codeload.github.com/${repo}/tar.gz/${ref}' | tar xz --strip-components=1`,
			],
			{ cwd: dir },
		);
	}
	refCache.set(slug, dir);
	return dir;
}

// --- in-run signals the harness already recorded ---
function readRunResult(runDir) {
	const path = join(runDir, 'result.json');
	if (!existsSync(path)) return {};
	try {
		const result = JSON.parse(readFileSync(path, 'utf8'));
		return {
			status: result?.status ?? null,
			tokens: result?.metadata?.usage?.totalTokens ?? null,
			costUsd: result?.metadata?.usage?.estimatedCostUsd ?? null,
			mcpUsage: result?.analysis?.mcpUsage ?? null,
			appTests: result?.analysis?.appTests ?? null,
		};
	} catch {
		return {};
	}
}

// --- per-run analysis ---
function analyzeRun(run) {
	const marker = readMarker(run.evalName);
	if (!marker) return null;

	const before = countButtonImports(prepareRef(marker.repo, marker.ref));
	const after = countButtonImports(run.projectDir);
	const {
		status = null,
		tokens = null,
		costUsd = null,
		mcpUsage = null,
		appTests = null,
	} = readRunResult(run.runDir);

	const row = {
		experiment: run.experiment,
		model: run.model,
		timestamp: run.timestamp,
		run: run.run,
		eval: run.evalName,
		// The fixture's pin as it stands today, which is not necessarily the pin an
		// older result directory was produced from.
		fixtureRef: `${marker.repo}@${marker.ref.slice(0, 12)}`,
		status,
		buttonImports: { before, after, delta: after - before },
		mcpUsage,
		tokens,
		costUsd,
		appTests,
		judged: null, // TODO: LLM-judge columns
	};
	writeFileSync(join(run.runDir, 'analysis.json'), JSON.stringify(row, null, 2) + '\n');
	return row;
}

// --- aggregate across repetitions ---
function mean(values) {
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
	return value === null ? null : Number(value.toFixed(digits));
}

function summarize(rows) {
	const groups = new Map();
	for (const row of rows) {
		const key = `${row.experiment}::${row.eval}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}

	return [...groups.values()].map((group) => {
		const deltas = group.map((row) => row.buttonImports.delta);
		const docCalls = group.flatMap((row) =>
			typeof row.mcpUsage?.documentationToolCalls === 'number'
				? [row.mcpUsage.documentationToolCalls]
				: [],
		);
		const costs = group.flatMap((row) => (typeof row.costUsd === 'number' ? [row.costUsd] : []));
		return {
			experiment: group[0].experiment,
			eval: group[0].eval,
			runs: group.length,
			passed: group.filter((row) => row.status === 'passed').length,
			reusedButton: deltas.filter((delta) => delta > 0).length,
			buttonDelta: {
				mean: round(mean(deltas)),
				min: Math.min(...deltas),
				max: Math.max(...deltas),
			},
			documentationToolCalls: { mean: round(mean(docCalls)), reported: docCalls.length },
			// null rather than 0 when no run reported a cost, so an unpriced model
			// does not read as a free one.
			costUsd: {
				total: costs.length === 0 ? null : round(costs.reduce((sum, cost) => sum + cost, 0)),
				reported: costs.length,
			},
		};
	});
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const runs = selectRuns(findRuns(RESULTS_DIR), options);
	const rows = [];
	const skipped = new Set();
	for (const run of runs) {
		const row = analyzeRun(run);
		if (row) rows.push(row);
		else skipped.add(run.evalName);
	}
	if (skipped.size > 0) {
		// A result directory outlives the fixture it came from; say so instead of
		// dropping those runs without a word.
		console.log(`Skipped runs with no matching fixture in evals/: ${[...skipped].join(', ')}`);
	}
	if (rows.length === 0) {
		console.log('No external-repo runs found under results/.');
		return;
	}

	rows.sort(
		(a, b) =>
			a.experiment.localeCompare(b.experiment) ||
			a.timestamp.localeCompare(b.timestamp) ||
			a.run - b.run,
	);
	const summary = summarize(rows);
	writeFileSync(
		join(RESULTS_DIR, 'agentic-ref-analysis.json'),
		JSON.stringify({ runs: rows, summary }, null, 2) + '\n',
	);

	console.table(
		rows.map((row) => ({
			experiment: row.experiment.replace(/^agentic-ref-/, ''),
			timestamp: row.timestamp,
			run: row.run,
			status: row.status,
			delta: row.buttonImports.delta,
			docCalls: row.mcpUsage?.documentationToolCalls ?? null,
			costUsd: row.costUsd,
		})),
	);
	console.table(
		summary.map((group) => ({
			experiment: group.experiment.replace(/^agentic-ref-/, ''),
			runs: group.runs,
			passed: group.passed,
			reusedButton: group.reusedButton,
			deltaMean: group.buttonDelta.mean,
			deltaRange: `${group.buttonDelta.min}–${group.buttonDelta.max}`,
			docCallsMean: group.documentationToolCalls.mean,
			costUsd: group.costUsd.total,
		})),
	);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
