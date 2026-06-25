import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d+Z$/;

const AGENT_NAMES = {
	'claude-code': 'Claude Code',
	'vercel-ai-gateway/claude-code': 'Claude Code',
	codex: 'Codex',
	'vercel-ai-gateway/codex': 'Codex',
};

function parseTimestamp(timestamp) {
	const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d+)Z$/);

	if (!match) {
		return timestamp;
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

async function latestExperimentResults(experiment) {
	const experimentDir = join('results', experiment);
	const timestampDirs = (await findTimestampDirs(experimentDir)).sort((a, b) => {
		const timeA = new Date(parseTimestamp(a.split('/').pop())).getTime();
		const timeB = new Date(parseTimestamp(b.split('/').pop())).getTime();
		return timeB - timeA;
	});

	const seenEvals = new Set();
	const results = [];

	for (const timestampDir of timestampDirs) {
		const timestamp = timestampDir.split('/').pop();
		let evalDirs;

		try {
			evalDirs = (await readdir(timestampDir)).filter((entry) => !entry.startsWith('.'));
		} catch {
			continue;
		}

		for (const evalName of evalDirs) {
			if (seenEvals.has(evalName)) {
				continue;
			}

			const evalDir = join(timestampDir, evalName);
			const summaryPath = join(evalDir, 'summary.json');
			const resultPath = join(evalDir, 'run-1', 'result.json');

			if (!(await pathExists(summaryPath)) || !(await pathExists(resultPath))) {
				continue;
			}

			const summary = await readJson(summaryPath);
			if (summary.valid === false) {
				continue;
			}

			const result = await readJson(resultPath);
			const evaluation = result.analysis?.evaluation;

			results.push({
				evalPath: evalName,
				result: {
					success: summary.passedRuns > 0,
					duration: summary.meanDuration * 1000,
					evalPath: evalName,
					timestamp: parseTimestamp(timestamp),
					score: evaluation?.percent,
					scoring: evaluation,
				},
			});
			seenEvals.add(evalName);
		}
	}

	return results.sort((a, b) => a.evalPath.localeCompare(b.evalPath));
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

	const total = Object.values(exported.results).flat().length;
	const passed = Object.values(exported.results)
		.flat()
		.filter((item) => item.result.success).length;

	console.log(
		`Exported ${total} results to agent-results.json (${passed} passed, ${total - passed} failed)`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
