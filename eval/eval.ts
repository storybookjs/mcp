import * as p from '@clack/prompts';
import { collectEvalArgs } from './lib/eval/collect-eval-args.ts';
import { runEval } from './lib/eval/run-eval.ts';

async function main(): Promise<void> {
	p.intro('🧪 Storybook MCP Eval');

	const args = await collectEvalArgs();

	const { allFailed } = await runEval(args);

	if (allFailed) {
		p.outro('❌ All runs failed');
		process.exit(1);
	}

	p.outro('✅ Eval complete');
}

await main();
