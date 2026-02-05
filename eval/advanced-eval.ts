import * as p from '@clack/prompts';
import { x } from 'tinyexec';
import { collectArgs } from './lib/collect-args.ts';
import { runTask } from './lib/run-task.ts';

p.intro('🧪 Storybook MCP Eval Harness');

const args = await collectArgs();

const { trialArgs } = await runTask({
	taskName: args.taskName,
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
				message: "Would you like to start the trial's Storybook?",
			});

p.outro('✨ Grading complete!');

if (startStorybook) {
	console.log('');
	await x('pnpm', ['run', 'storybook'], {
		nodeOptions: {
			cwd: trialArgs.projectPath,
			stdio: 'inherit',
		},
	});
}
