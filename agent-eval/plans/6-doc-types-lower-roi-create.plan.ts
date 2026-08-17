// Group 6 of 6 — The remaining documentation facets
//
// Accessibility guidance and brand/animation guidance, the two facets with
// the lowest expected return. Last, so an interrupted round loses these
// rather than anything above.
//
// UI creation workflows (701 new UI, 706 new UI on a schedule).
//
// 2 arm(s) × 2 eval(s) = 4 cells, 40 runs, 2 batches of at most 2 cells.
// Cells collected by an earlier group are skipped.
//
//   pnpm eval:plan --config plans/6-doc-types-lower-roi-create.plan.ts --dry
//   pnpm eval:plan --config plans/6-doc-types-lower-roi-create.plan.ts
import type { RunPlan } from '../lib/agentic-reference/run-plan.ts';

export default {
	experiments: ['agentic-ref-cc-a11y-opus-high', 'agentic-ref-cc-brand-animation-opus-high'],
	evals: ['701', '706'],
	runs: 10,
	parallelMax: 20,
	// Off, so an interrupted plan resumes and repeated arms are collected once.
	force: false,
	// Off, so infra and timeout runs are dropped rather than mixed into the
	// sample; the shortfall is reported as a gap with its top-up command.
	ackFailures: false,
	// Set this when the environment around a run changes in a way the harness's
	// fingerprint cannot see — a regenerated Droppy MCP build at the same branch,
	// a new sandbox image, a new agent CLI. A fixture edit needs no cutoff: it
	// changes the fingerprint on its own.
	// since: '2026-08-14',
} satisfies RunPlan;
