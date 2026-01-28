import * as p from '@clack/prompts';
import { collectOrchestrationArgs } from './lib/orchestrate/collect-orchestration-args.ts';
import { runOrchestration } from './lib/orchestrate/run-orchestration.ts';

async function main(): Promise<void> {
	p.intro('🧪 Eval Orchestrator');

	const args = await collectOrchestrationArgs();

	await runOrchestration(args);

	p.outro('✅ Orchestration complete');
}

await main();
