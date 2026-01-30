import * as p from '@clack/prompts';
import { collectOrchestrationArgs } from './lib/orchestrate/collect-orchestration-args.ts';
import { runOrchestration } from './lib/orchestrate/run-orchestration.ts';

async function main(): Promise<void> {
	p.intro('🧪 Eval Orchestrator');

	const args = await collectOrchestrationArgs();

	const { allFailed } = await runOrchestration(args);

	if (allFailed) {
		p.outro('❌ All runs failed');
		process.exit(1);
	}

	p.outro('✅ Orchestration complete');
}

await main();
