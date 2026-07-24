// Minimal educational agentic-reference experiment — see
// agent-eval/AGENTIC-REFERENCE-EVAL.md for the full picture. One agent
// configuration (claude-code, opus, high effort) against one eval
// (700-ar-hello). Runs zero evals unless EVAL_AGENTIC_REFERENCE=1 — the
// same gate the fuller agentic-reference scaffold (SB-1724, branch
// yann/sb-1724-agentic-reference-scaffold) uses — so this file joins the
// default experiment matrix (`pnpm eval`/CI discovers every file under
// experiments/) without ever spending anything by default.
//
// Deliberately self-contained: no lib/agentic-reference/* case registry or
// design-system canary installer. The 700-ar-hello benchmark app
// (yannbf/mealdrop@base-ui-migration-squashed) already has
// `@base-ui/react` + `@droppy/theme` pinned in its package.json and the
// wrapper components already written, so all this needs is to download and
// extract that app into the sandbox, then `yarn install`.
import type { ExperimentConfig, Sandbox } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../lib/experiment.ts';
import { setupSandbox } from '../lib/templates.ts';

const BENCHMARK_APP_TARBALL_URL =
	'https://codeload.github.com/yannbf/mealdrop/tar.gz/base-ui-migration-squashed';

function isAgenticReferenceEnabled(): boolean {
	return process.env.EVAL_AGENTIC_REFERENCE === '1';
}

async function setup(sandbox: Sandbox): Promise<void> {
	// Base harness scaffolding (agent config etc.) — the eval fixture's
	// package.json has no `evals.template`, so this is a no-op beyond that.
	await setupSandbox(sandbox, { agent: 'claude-code', integration: 'plugin' });

	// Materialize the benchmark app: download the GitHub codeload tarball and
	// extract it over the sandbox root. `--strip-components=1` drops the
	// tarball's top-level `mealdrop-<ref>/` directory. The design system is
	// already pinned in this app's package.json — `yarn install` is the only
	// remaining step (no separate canary-install pass needed).
	const materialize = await sandbox.runCommand('bash', [
		'-lc',
		[
			'set -euo pipefail',
			`curl -fsSL '${BENCHMARK_APP_TARBALL_URL}' | tar xz --strip-components=1`,
			'yarn install',
		].join('\n'),
	]);
	if (materialize.exitCode !== 0) {
		throw new Error(
			`700-ar-hello: failed to materialize/install the Mealdrop benchmark app: ${
				materialize.stderr || materialize.stdout
			}`,
		);
	}
}

export default {
	...DEFAULT_EXPERIMENT_CONFIG,
	agent: 'claude-code', // direct Anthropic API, requires ANTHROPIC_API_KEY
	model: 'opus',
	agentOptions: { effort: 'high' },
	// A real yarn install against the Mealdrop app is heavier than the
	// shared 900s default (see lib/experiment.ts) covers comfortably.
	timeout: 1800,
	evals: isAgenticReferenceEnabled() ? ['700-ar-hello'] : [],
	setup,
} satisfies ExperimentConfig;
