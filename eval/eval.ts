import * as p from '@clack/prompts';
import { x } from 'tinyexec';
import { collectArgs } from './lib/collect-args.ts';
import { runEvaluation } from './lib/run-evaluation.ts';

p.intro('🧪 Storybook MCP Eval');

const args = await collectArgs();

const { experimentArgs } = await runEvaluation({
	evalName: args.eval,
	context: args.context,
	agent: args.agent,
	model: args.model,
	systemPrompts: args.systemPrompts,
	uploadId: args.uploadId,
	verbose: args.verbose,
	storybook: args.storybook,
	runId: args.runId,
	label: args.label,
});

const startStorybook =
	args.storybook !== undefined
		? args.storybook
		: await p.confirm({
				message: "Would you like to start the experiment's Storybook?",
			});

p.outro('✨ Evaluation complete!');

if (startStorybook) {
	console.log('');
	await x('pnpm', ['run', 'storybook'], {
		nodeOptions: {
			cwd: experimentArgs.projectPath,
			stdio: 'inherit',
		},
	});
}
