import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'agent-eval',
		// .eval-cache/ and results/ hold materialized *app* source: the pinned
		// external-repo checkouts the offline analyzer diffs against, and the
		// post-agent project trees copied out of each run. Those test files belong
		// to that app, not to this harness, and run without its environment — so a
		// developer who has run an agentic-reference eval would otherwise collect a
		// dozen red files that CI (which has neither directory) never sees.
		// .agentic-ref/ is excluded too: it symlinks evals/ and results/ into a
		// throwaway work directory, and without this a plain `results/**` exclude
		// does not reach the same trees through their second path.
		//
		// The root .oxlintrc.json ignores the same set, for the same reason:
		// Mealdrop's own tsconfig uses a `baseUrl` that oxlint rejects outright, so
		// a populated ref cache turns `pnpm lint` red on someone else's codebase.
		exclude: [...configDefaults.exclude, '.eval-cache/**', 'results/**', '.agentic-ref/**'],
	},
});
