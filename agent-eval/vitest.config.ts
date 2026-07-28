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
		exclude: [...configDefaults.exclude, '.eval-cache/**', 'results/**'],
	},
});
