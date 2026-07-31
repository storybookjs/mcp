import { configDefaults, defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'agent-eval',
		// .eval-cache/ contains the external repo when using `setupExternalRepo`.
		// results/ contains post-eval project trees copied out of each run.
		// .agentic-ref/ symlinks both into the generated work directory.
		exclude: [...configDefaults.exclude, '.eval-cache/**', 'results/**', '.agentic-ref/**'],
	},
});
