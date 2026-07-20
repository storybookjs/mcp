// Central parameterisation for the "SB agentic reference" eval project
// (SB-1724): an A/B eval that runs coding agents through UI workflows on a
// Base UI benchmark app under 4 context cases (see cases.ts) to measure the
// effect of the Storybook MCP relative to no-docs / official-docs / a
// community MCP baseline.
//
// Every value below is env-overridable with a cheap-by-default value, so the
// same experiment files serve both a free local dry run and the real
// R-repetition run (see AGENTIC-REFERENCE.md for the full run recipe).

/**
 * Master gate: the ar-* experiments (agent-eval/experiments/ar-*.ts) export
 * zero evals unless this is set, so they never run as part of the default
 * `pnpm eval` / CI flow. Mirrors the EVAL_EXTRA_MODELS idiom in
 * lib/experiment.ts.
 */
export function isAgenticReferenceEnabled(): boolean {
	return process.env.EVAL_AGENTIC_REFERENCE === '1';
}

/**
 * Second gate specific to the control-community-mcp case: its setup always
 * throws (SB-1682 — no community Base UI MCP identified yet), so its
 * experiment additionally requires this flag on top of
 * EVAL_AGENTIC_REFERENCE=1. Belt-and-suspenders against ever running it by
 * accident once a community MCP is picked and someone forgets to gate it.
 */
export function isCommunityMcpEnabled(): boolean {
	return process.env.AR_COMMUNITY_MCP === '1';
}

/** Repetitions per eval. Default 1 keeps local/dry runs cheap; real runs set AR_RUNS=10. */
export const AR_RUNS = Number.parseInt(process.env.AR_RUNS ?? '1', 10);

/** GitHub repo hosting the Mealdrop-on-Base-UI benchmark app (SB-1680/SB-1681). */
export const AR_BENCHMARK_REPO = process.env.AR_BENCHMARK_REPO ?? 'yannbf/mealdrop';

/**
 * Git ref of the benchmark app to check out. `agentic-reference/baseline` is
 * the default target for 4 of the 5 workflows; migrate-to-ds (704) will use
 * `agentic-reference/original` instead once both branches exist. Neither
 * branch has been created yet — see benchmark-app.ts.
 */
export const AR_BENCHMARK_REF = process.env.AR_BENCHMARK_REF ?? 'agentic-reference/baseline';

/**
 * pkg.pr.new spec for the Base UI design-system package the treatment case's
 * benchmark app would install. Empty until the design system Storybook
 * (SB-1725) has a build to publish.
 */
export const AR_DS_PACKAGE = process.env.AR_DS_PACKAGE ?? '';

/**
 * URL of the Storybook MCP server the treatment case wires into the sandbox
 * agent's `.mcp.json`. Defaults to the harness's local convention (same
 * default port the existing MCP experiments use, see
 * STORYBOOK_MCP_URL in lib/templates.ts) — real runs will point this at the
 * published design-system Storybook once SB-1685 (orchestration) lands.
 */
export const AR_STORYBOOK_MCP_URL = process.env.AR_STORYBOOK_MCP_URL ?? 'http://127.0.0.1:6006/mcp';

// Our own eval registry — deliberately NOT added to CORE_STORYBOOK_EVALS or
// any other list in lib/experiment.ts (that file is off-limits, see
// AGENTIC-REFERENCE.md). The 7xx band is reserved for this project.
export const AGENTIC_REFERENCE_EVALS = [
	'700-ar-create-ui',
	'701-ar-rework-ui',
	'702-ar-fix-bug',
	'703-ar-fix-a11y',
	'704-ar-migrate-to-ds',
] as const;

export type AgenticReferenceEvalName = (typeof AGENTIC_REFERENCE_EVALS)[number];
