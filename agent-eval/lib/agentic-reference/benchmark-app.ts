// Stub for the real agentic-reference benchmark app. TODO(SB-1680/SB-1681):
// once `agentic-reference/original` and `agentic-reference/baseline` exist in
// AR_BENCHMARK_REPO (Mealdrop reimplemented with Base UI), this will clone
// the configured ref into the sandbox in place of the generic `vite-app`
// template the 700-704 fixtures use today.
//
// Not called from cases.ts yet — wiring it in is part of SB-1680/SB-1681,
// once there is something to check out.

import type { Sandbox } from '@vercel/agent-eval';

import { AR_BENCHMARK_REF, AR_BENCHMARK_REPO } from './config.ts';

/**
 * Will replace the sandbox's placeholder `vite-app` project with a checkout
 * of `AR_BENCHMARK_REPO`@`AR_BENCHMARK_REF`. Currently always throws —
 * nothing should call this until the benchmark branches exist.
 */
export async function materializeBenchmarkApp(sandbox: Sandbox): Promise<void> {
	void sandbox;
	throw new Error(
		`agentic-reference: benchmark app materialisation not implemented yet (SB-1680/SB-1681). ` +
			`Would clone ${AR_BENCHMARK_REPO}@${AR_BENCHMARK_REF} into the sandbox.`,
	);
}
