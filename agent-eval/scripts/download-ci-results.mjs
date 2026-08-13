#!/usr/bin/env node
// Downloads the most recent agent-eval-results artifacts from GitHub Actions
// and extracts them into agent-eval/results, so CI runs are inspectable in the
// local playground (pnpm playground) and by local analysis tooling.
//
// Usage: node scripts/download-ci-results.mjs [count]
//   count: number of artifacts to download (default 20)
//
// Requires an authenticated GitHub CLI (gh auth login) and a tar binary.
// Result snapshots are keyed by experiment name and run timestamp, so
// artifacts from different CI runs merge into the results directory without
// colliding, and re-downloading the same artifact is idempotent.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Workflows upload either the bare name (agent-eval.yml) or a per-dispatch
// name suffixed with the run id (agentic-ref-eval.yml); both carry the same
// agent-eval-results.tgz payload.
const ARTIFACT_NAME = 'agent-eval-results';
const ARTIFACT_PREFIX = `${ARTIFACT_NAME}-`;
const agentEvalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = path.join(agentEvalDir, 'results');

const count = Number(process.argv[2] ?? '20');
if (!Number.isInteger(count) || count < 1 || count > 100) {
	console.error(`Expected count between 1 and 100, got: ${process.argv[2]}`);
	process.exit(1);
}

function gh(args, options = {}) {
	try {
		// cwd pins gh's repo resolution to this checkout, so the script also
		// works when invoked from outside the repository.
		return execFileSync('gh', args, { cwd: agentEvalDir, ...options });
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.error('The GitHub CLI (gh) is required. Install it and run: gh auth login');
			process.exit(1);
		}
		throw error;
	}
}

// Artifact names now vary per dispatch, so the API's exact-match `name=` filter
// no longer selects them; page through everything and match the prefix here.
// With --paginate, --jq runs per page and emits one JSON object per line.
const artifacts = gh(
	[
		'api',
		'--paginate',
		'repos/{owner}/{repo}/actions/artifacts?per_page=100',
		'--jq',
		'.artifacts[] | select(.expired | not)',
	],
	{ encoding: 'utf8' },
)
	.split('\n')
	.filter((line) => line.trim() !== '')
	.map((line) => JSON.parse(line))
	.filter(({ name }) => name === ARTIFACT_NAME || name.startsWith(ARTIFACT_PREFIX))
	.sort((a, b) => b.created_at.localeCompare(a.created_at))
	.slice(0, count);

if (artifacts.length === 0) {
	console.error(`No unexpired ${ARTIFACT_NAME} artifacts found.`);
	process.exit(1);
}

console.log(`Downloading ${artifacts.length} ${ARTIFACT_NAME} artifact(s) into ${resultsDir}`);

for (const artifact of artifacts) {
	const run = artifact.workflow_run;
	if (!run?.id) {
		console.warn(`- skipping artifact ${artifact.id}: no workflow run recorded`);
		continue;
	}
	console.log(
		`- ${artifact.name} (${artifact.created_at}, branch ${run.head_branch ?? 'unknown'}, run ${run.id})`,
	);

	const workDir = mkdtempSync(path.join(tmpdir(), 'agent-eval-artifact-'));
	try {
		// gh streams the artifact zip to disk and unpacks it, leaving the
		// agent-eval-results.tgz that the eval workflows archive.
		gh(['run', 'download', String(run.id), '--name', artifact.name, '--dir', workDir]);
		// Extract inside the temp directory and only the results/ subtree, so
		// an artifact tarball can never write outside it; then merge that
		// subtree into agent-eval/results.
		execFileSync('tar', [
			'-xzf',
			path.join(workDir, `${ARTIFACT_NAME}.tgz`),
			'-C',
			workDir,
			'results',
		]);
		cpSync(path.join(workDir, 'results'), resultsDir, { recursive: true });
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

console.log('Done. Browse the results with: pnpm playground');
