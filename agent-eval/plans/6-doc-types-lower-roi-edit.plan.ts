// Group 6 of 6 — The remaining documentation facets
//
// Accessibility guidance and brand/animation guidance, the two facets with
// the lowest expected return. Last, so an interrupted round loses these
// rather than anything above.
//
// UI editing workflows (702 rework, 703 fix a bug, 704 fix a11y).
//
// 2 arm(s) × 3 eval(s) = 6 cells, 60 runs, 3 batches of at most 2 cells.
// Cells collected by an earlier group are skipped.
//
//   pnpm eval:plan --config plans/6-doc-types-lower-roi-edit.plan.ts --dry
//   pnpm eval:plan --config plans/6-doc-types-lower-roi-edit.plan.ts
import type { RunPlan } from '../lib/agentic-reference/run-plan.ts';

export default {
	experiments: ['agentic-ref-cc-a11y-opus-high', 'agentic-ref-cc-brand-animation-opus-high'],
	evals: ['702', '703', '704'],
	runs: 10,
	parallelMax: 10,
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
