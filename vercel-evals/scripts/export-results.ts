import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { scoreThreshold } from '../lib/evaluation-scoring.ts';

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d+Z$/;
const RUN_DIR_RE = /^run-(\d+)$/;

const README_PATH = 'README.md';
const RESULTS_START = '<!-- AGENT_RESULTS:START -->';
const RESULTS_END = '<!-- AGENT_RESULTS:END -->';

const AGENT_NAMES = {
	'claude-code': 'Claude Code',
	'vercel-ai-gateway/claude-code': 'Claude Code',
	codex: 'Codex',
	'vercel-ai-gateway/codex': 'Codex',
};

function parseTimestamp(timestamp) {
	const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d+)Z$/);

	if (!match) {
		throw new Error(`Invalid result timestamp directory: ${timestamp}`);
	}

	return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf-8'));
}

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function findTimestampDirs(dir) {
	const results = [];
	let entries;

	try {
		entries = (await readdir(dir)).filter((entry) => !entry.startsWith('.'));
	} catch {
		return results;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		if (TIMESTAMP_RE.test(entry)) {
			results.push(fullPath);
			continue;
		}

		const info = await stat(fullPath);
		if (info.isDirectory()) {
			results.push(...(await findTimestampDirs(fullPath)));
		}
	}

	return results;
}

async function getExperimentAgent(experiment) {
	const configPath = join('experiments', `${experiment}.ts`);

	try {
		const content = await readFile(configPath, 'utf-8');
		const match = content.match(/agent:\s*['"]([^'"]+)['"]/);
		return match?.[1] ? (AGENT_NAMES[match[1]] ?? match[1]) : 'Unknown';
	} catch {
		return 'Unknown';
	}
}

function mean(values) {
	if (values.length === 0) return undefined;
	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Read every `run-N/result.json` for an eval and pull out each run's weighted score. */
async function readEvalRuns(evalDir) {
	let entries;
	try {
		entries = await readdir(evalDir);
	} catch {
		return [];
	}

	const runDirs = entries
		.filter((entry) => RUN_DIR_RE.test(entry))
		.sort((a, b) => Number(a.match(RUN_DIR_RE)[1]) - Number(b.match(RUN_DIR_RE)[1]));

	const runs = [];
	for (const runDir of runDirs) {
		const resultPath = join(evalDir, runDir, 'result.json');
		if (!(await pathExists(resultPath))) continue;

		const result = await readJson(resultPath);
		const evaluation = result.analysis?.evaluation;
		runs.push({
			run: runDir,
			percent: typeof evaluation?.percent === 'number' ? evaluation.percent : undefined,
			status: result.status,
			items: Array.isArray(evaluation?.items)
				? evaluation.items.map((item) => ({ id: item.id, score: item.score }))
				: [],
		});
	}

	return runs;
}

/**
 * Aggregate the most recent run of each fixture into a mean weighted score (the
 * "success rate") and a pass/fail against the fixture's threshold. The threshold
 * comes straight from the scorer registry (`scoreThreshold`), not from the runs.
 */
async function latestExperimentResults(experiment) {
	const experimentDir = join('results', experiment);
	const timestampDirs = (await findTimestampDirs(experimentDir)).sort((a, b) => {
		const timeA = new Date(parseTimestamp(basename(a))).getTime();
		const timeB = new Date(parseTimestamp(basename(b))).getTime();
		return timeB - timeA;
	});

	const latestTimestampDir = timestampDirs[0];
	if (!latestTimestampDir) {
		return [];
	}

	const timestamp = basename(latestTimestampDir);
	const results = [];

	let evalDirs;
	try {
		evalDirs = (await readdir(latestTimestampDir)).filter((entry) => !entry.startsWith('.'));
	} catch {
		return results;
	}

	for (const evalName of evalDirs) {
		const evalDir = join(latestTimestampDir, evalName);
		const summaryPath = join(evalDir, 'summary.json');
		if (!(await pathExists(summaryPath))) continue;

		const summary = await readJson(summaryPath);
		if (summary.valid === false) continue;

		const runs = await readEvalRuns(evalDir);
		if (runs.length === 0) continue;

		const scores = runs.map((run) => run.percent).filter((percent) => typeof percent === 'number');
		const meanScore = mean(scores);
		const threshold = scoreThreshold(evalName);
		const passed = meanScore !== undefined ? meanScore >= threshold : undefined;

		results.push({
			evalPath: evalName,
			result: {
				evalPath: evalName,
				timestamp: parseTimestamp(timestamp),
				runs: runs.length,
				scores,
				meanScore,
				threshold,
				passed,
				runDetails: runs.map((run) => ({
					run: run.run,
					score: run.percent,
					status: run.status,
					items: run.items,
				})),
				duration: (summary.meanDuration ?? 0) * 1000,
			},
		});
	}

	return results.sort((a, b) => a.evalPath.localeCompare(b.evalPath));
}

function formatPercent(value) {
	return typeof value === 'number' ? `${value}%` : '—';
}

function formatResult(passed) {
	if (passed === true) return '✅';
	if (passed === false) return '❌';
	return '—';
}

function renderResultsSection(exported) {
	const lines = [
		RESULTS_START,
		`_Auto-generated by \`pnpm run export-results\` — last updated ${exported.metadata.exportedAt}._`,
		'',
		'**Mean score** is the average weighted `lib/scoring` percentage across the runs of the most',
		'recent experiment — the success rate. A fixture **passes** when its mean clears the',
		'threshold; CI fails the build otherwise.',
		'',
	];

	for (const experiment of exported.metadata.experiments) {
		const rows = exported.results[experiment.name] ?? [];
		lines.push(`### ${experiment.agentHarness} (\`${experiment.name}\`)`, '');
		lines.push(
			'| Fixture | Mean score | Runs | Threshold | Result |',
			'| --- | --- | --- | --- | --- |',
		);

		for (const { result } of rows) {
			lines.push(
				`| ${result.evalPath} | ${formatPercent(result.meanScore)} | ${result.runs} | ${formatPercent(result.threshold)} | ${formatResult(result.passed)} |`,
			);
		}

		lines.push('');
	}

	lines.push(RESULTS_END);
	return lines.join('\n');
}

async function updateReadme(exported) {
	const section = renderResultsSection(exported);

	let readme;
	try {
		readme = await readFile(README_PATH, 'utf-8');
	} catch {
		console.warn(`Skipping README update: ${README_PATH} not found.`);
		return;
	}

	const startIndex = readme.indexOf(RESULTS_START);
	const endIndex = readme.indexOf(RESULTS_END);

	if (startIndex !== -1 && endIndex !== -1) {
		const before = readme.slice(0, startIndex);
		const after = readme.slice(endIndex + RESULTS_END.length);
		await writeFile(README_PATH, `${before}${section}${after}`);
		return;
	}

	const appended = `${readme.trimEnd()}\n\n## Latest Results\n\n${section}\n`;
	await writeFile(README_PATH, appended);
}

/** Print each fixture's per-run scores (and per-metric breakdown) to stdout. */
function logRunDetails(exported) {
	for (const experiment of exported.metadata.experiments) {
		const rows = exported.results[experiment.name] ?? [];
		if (rows.length === 0) continue;

		console.log(`\n${experiment.agentHarness} (${experiment.name})`);
		for (const { result } of rows) {
			const verdict = result.passed === true ? '✅' : result.passed === false ? '❌' : '—';
			console.log(
				`  ${result.evalPath} — mean ${formatPercent(result.meanScore)} ` +
					`/ threshold ${formatPercent(result.threshold)} → ${verdict} (${result.runs} run(s))`,
			);

			for (const run of result.runDetails) {
				const items = run.items.map((item) => `${item.id}=${item.score ? '✓' : '✗'}`).join(' ');
				const status = run.status && run.status !== 'passed' ? ` [${run.status}]` : '';
				console.log(
					`      ${run.run}: ${formatPercent(run.score)}${status}${items ? `  ${items}` : ''}`,
				);
			}
		}
	}
}

async function main() {
	const resultsDir = 'results';
	let experiments = process.argv.slice(2);

	if (experiments.length === 0) {
		experiments = (await readdir(resultsDir)).filter((entry) => !entry.startsWith('.'));
	}

	const exported = {
		metadata: {
			exportedAt: new Date().toISOString(),
			experiments: [],
		},
		results: {},
	};

	for (const experiment of experiments) {
		const results = await latestExperimentResults(experiment);
		if (results.length === 0) {
			continue;
		}

		exported.metadata.experiments.push({
			name: experiment,
			agentHarness: await getExperimentAgent(experiment),
			avgDuration:
				results.reduce((sum, item) => sum + item.result.duration, 0) / results.length / 1000,
		});
		exported.results[experiment] = results;
	}

	await writeFile('agent-results.json', `${JSON.stringify(exported, null, 2)}\n`);
	await updateReadme(exported);
	logRunDetails(exported);

	const allRows = Object.values(exported.results).flat();
	const belowBar = allRows.filter(({ result }) => result.passed === false);
	const cleared = allRows.filter(({ result }) => result.passed === true).length;

	console.log(
		`Exported ${allRows.length} fixture result(s) to agent-results.json ` +
			`(${cleared} cleared the bar, ${belowBar.length} below).`,
	);

	if (belowBar.length > 0) {
		console.error('\nFixtures below their score threshold:');
		for (const { result } of belowBar) {
			console.error(`  - ${result.evalPath}: mean ${result.meanScore}% < ${result.threshold}%`);
		}
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
