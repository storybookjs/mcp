import { readFile } from 'node:fs/promises';

const MARKER = '<!-- eval-results-comment -->';
const RESULTS_PATH = 'vercel-evals/agent-results.json';

function formatPercent(value) {
	return typeof value === 'number' ? `${value}%` : '—';
}

function formatResult(passed) {
	if (passed === true) return '✅';
	if (passed === false) return '❌';
	return '—';
}

/** Render the PR comment body from the `agent-results.json` written by `export-results`. */
function renderBody(exported) {
	const allRows = Object.values(exported.results ?? {}).flat();
	const cleared = allRows.filter(({ result }) => result.passed === true).length;
	const below = allRows.filter(({ result }) => result.passed === false).length;

	const summary =
		allRows.length === 0
			? 'No eval results were produced — check the **Run evals** step logs.'
			: `**${cleared}/${allRows.length}** fixture(s) cleared their threshold` +
				(below > 0 ? `, **${below}** below the bar. ❌` : '. ✅');

	const lines = [MARKER, '## 🤖 Agent eval results', '', summary, ''];

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
	}

	lines.push(
		`_Mean score is the average weighted \`lib/scoring\` percentage across runs; a fixture passes when its mean clears the threshold. Last updated ${exported.metadata?.exportedAt ?? 'unknown'}._`,
		'',
	);

	return lines.join('\n');
}

const FALLBACK = `${MARKER}

## 🤖 Agent eval results

⚠️ No results were exported (\`${RESULTS_PATH}\` missing) — the **Run evals** step likely failed before \`export-results\` ran. Check its logs.
`;

/**
 * Post — or update in place — a single PR comment carrying the exported eval results.
 *
 * Invoked from the eval workflow via actions/github-script, which supplies an
 * authenticated Octokit (`github`), the run `context`, and `core` for logging.
 * `PR_NUMBER` comes from the workflow env (PR event or workflow_dispatch input).
 */
export default async function commentEvalResults({ github, context, core }) {
	const issueNumber = Number(process.env.PR_NUMBER);
	if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
		core.setFailed(`Invalid PR_NUMBER: "${process.env.PR_NUMBER}"`);
		return;
	}

	let body;
	try {
		body = renderBody(JSON.parse(await readFile(RESULTS_PATH, 'utf8')));
	} catch (error) {
		core.warning(`Could not read ${RESULTS_PATH}: ${error.message}; posting fallback notice.`);
		body = FALLBACK;
	}

	const { owner, repo } = context.repo;

	// Reuse one self-updating comment (matched by MARKER) instead of posting a new one each run.
	const comments = await github.paginate(github.rest.issues.listComments, {
		owner,
		repo,
		issue_number: issueNumber,
		per_page: 100,
	});
	const existing = comments.find((comment) => comment.body?.includes(MARKER));

	if (existing) {
		await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
		core.info(`Updated eval results comment ${existing.html_url ?? existing.id}`);
	} else {
		const { data } = await github.rest.issues.createComment({
			owner,
			repo,
			issue_number: issueNumber,
			body,
		});
		core.info(`Created eval results comment ${data.html_url ?? data.id}`);
	}
}
