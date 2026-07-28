import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'agent-eval',
		// Both directories hold materialized *app* source: .eval-cache/ the pinned
		// external-repo checkouts the offline analyzer diffs against, results/ the
		// post-agent project trees copied out of each run. Those test files belong
		// to that app, not to this harness, and run without its environment — so a
		// developer who has run an agentic-reference eval would otherwise collect a
		// dozen red files that CI (which has neither directory) never sees.
		//
		// The root .oxlintrc.json ignores the same pair, for the same reason:
		// Mealdrop's own tsconfig uses a `baseUrl` that oxlint rejects outright, so
		// a populated ref cache turns `pnpm lint` red on someone else's codebase.
		exclude: [...configDefaults.exclude, '.eval-cache/**', 'results/**'],
	},
});
