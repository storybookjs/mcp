import { readFile } from 'node:fs/promises';

const START = '<!-- eval-results:start -->';
const END = '<!-- eval-results:end -->';
const RESULTS_PATH = 'vercel-evals/agent-results.json';

function formatPercent(value) {
	return typeof value === 'number' ? `${value}%` : '—';
}

function formatResult(passed) {
	if (passed === true) return '✅';
	if (passed === false) return '❌';
	return '—';
}

/** Tally how many runs each rubric metric passed, across the fixture's runs. */
function metricBreakdown(result) {
	const tally = new Map();
	for (const run of result.runDetails ?? []) {
		for (const item of run.items ?? []) {
			const entry = tally.get(item.id) ?? { passed: 0, total: 0 };
			entry.total += 1;
			if (item.score) entry.passed += 1;
			tally.set(item.id, entry);
		}
	}

	return [...tally.entries()].map(([id, { passed, total }]) => {
		const icon = passed === total ? '✅' : passed === 0 ? '❌' : '⚠️';
		return `- ${icon} \`${id}\` — ${passed}/${total} run(s)`;
	});
}

/** Render the eval-results section (no markers) from the exported `agent-results.json`. */
export function renderBody(exported) {
	const allRows = Object.values(exported.results ?? {}).flat();
	const cleared = allRows.filter(({ result }) => result.passed === true).length;
	const below = allRows.filter(({ result }) => result.passed === false).length;

	const summary =
		allRows.length === 0
			? 'No eval results were produced — check the **Run evals** step logs.'
			: `**${cleared}/${allRows.length}** fixture(s) cleared their threshold` +
				(below > 0 ? `, **${below}** below the bar. ❌` : '. ✅');

	const lines = ['## 🤖 Agent eval results', '', summary, ''];

	for (const experiment of exported.metadata?.experiments ?? []) {
		const rows = exported.results?.[experiment.name] ?? [];
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

		// Collapsible per-fixture breakdown: which rubric metrics passed vs not.
		for (const { result } of rows) {
			const breakdown = metricBreakdown(result);
			if (breakdown.length === 0) continue;
			lines.push(
				`<details><summary>${result.evalPath} — metric breakdown</summary>`,
				'',
				...breakdown,
				'',
				'</details>',
				'',
			);
		}
	}

	lines.push(
		`_Mean score is the average weighted \`lib/scoring\` percentage across runs; a fixture passes when its mean clears the threshold. Last updated ${exported.metadata?.exportedAt ?? 'unknown'}._`,
	);

	return lines.join('\n');
}

const FALLBACK = `## 🤖 Agent eval results

⚠️ No results were exported (\`${RESULTS_PATH}\` missing) — the **Run evals** step likely failed before \`export-results\` ran. Check its logs.`;

/** Splice the eval section (between markers) into the PR body, preserving the rest. */
export function upsertSection(body, section) {
	const block = `${START}\n${section}\n${END}`;
	const current = body ?? '';
	const startIndex = current.indexOf(START);
	const endIndex = current.indexOf(END);

	if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
		return current.slice(0, startIndex) + block + current.slice(endIndex + END.length);
	}

	return current.trim().length > 0 ? `${current.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

/**
 * Inject the eval results into the PR description (between markers), leaving the
 * rest of the description untouched.
 *
 * Invoked from the eval workflow via actions/github-script, which supplies an
 * authenticated Octokit (`github`), the run `context`, and `core` for logging.
 * `PR_NUMBER` comes from the workflow env (PR event or workflow_dispatch input).
 */
export default async function updatePrDescription({ github, context, core }) {
	const prNumber = Number(process.env.PR_NUMBER);
	if (!Number.isInteger(prNumber) || prNumber <= 0) {
		core.setFailed(`Invalid PR_NUMBER: "${process.env.PR_NUMBER}"`);
		return;
	}

	let section;
	try {
		section = renderBody(JSON.parse(await readFile(RESULTS_PATH, 'utf8')));
	} catch (error) {
		core.warning(`Could not read ${RESULTS_PATH}: ${error.message}; using fallback notice.`);
		section = FALLBACK;
	}

	const { owner, repo } = context.repo;
	const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
	const body = upsertSection(pr.body, section);

	if (body === (pr.body ?? '')) {
		core.info('PR description already up to date.');
		return;
	}

	await github.rest.pulls.update({ owner, repo, pull_number: prNumber, body });
	core.info(`Updated PR #${prNumber} description with eval results.`);
}
