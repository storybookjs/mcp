import * as p from '@clack/prompts';
import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ExperimentArgs } from './types.ts';
import { prepareExperiment } from './lib/prepare-experiment.ts';
import { evaluate } from './lib/evaluations/evaluate.ts';
import { collectArgs } from './lib/collect-args.ts';
import { generatePrompt } from './lib/generate-prompt.ts';

p.intro('🧪 Storybook MCP Eval');

const args = await collectArgs();

const evalPath = path.resolve(path.join('evals', args.eval));
// Validate that eval directory exists
const dirExists = await fs
	.access(evalPath)
	.then(() => true)
	.catch(() => false);
if (!dirExists) {
	p.log.error(`Eval directory does not exist: ${evalPath}`);
	process.exit(1);
}

const agents = {
	'claude-code': claudeCodeCli,
};

const agent = agents[args.agent as keyof typeof agents];

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const experimentDirName = `${args.agent}-no-context-${timestamp}`;
const experimentPath = path.join(evalPath, 'experiments', experimentDirName);
const projectPath = path.join(experimentPath, 'project');
const resultsPath = path.join(experimentPath, 'results');
const experimentArgs: ExperimentArgs = {
	evalPath,
	experimentPath,
	projectPath,
	resultsPath,
	verbose: args.verbose,
	hooks: await import(path.join(evalPath, 'hooks.ts'))
		.then((mod) => mod.default)
		.catch(() => ({})),
};

p.log.info(`Running experiment '${args.eval}' with agent '${args.agent}'`);
process.exit(0);
await prepareExperiment(experimentArgs);

const prompt = await generatePrompt(evalPath, args.context);

const promptSummary = await agent.execute(
	prompt,
	experimentArgs,
	args.context.type === 'mcp-server' ? args.context.mcpServerConfig : undefined,
);

const evaluationSummary = await evaluate(experimentArgs, args.agent);

await fs.writeFile(path.join(experimentPath, 'prompt.md'), prompt);
await fs.writeFile(
	path.join(resultsPath, 'summary.json'),
	JSON.stringify({ ...promptSummary, ...evaluationSummary }, null, 2),
);

p.log.info('Summary:');
p.log.message(`🏗️  Build: ${evaluationSummary.buildSuccess ? '✅' : '❌'}`);
p.log.message(
	`🔍 Type Check: ${evaluationSummary.typeCheckSuccess ? '✅' : '❌'}`,
);
p.log.message(`✨ Lint: ${evaluationSummary.lintSuccess ? '✅' : '❌'}`);
p.log.message(`🧪 Tests: ${evaluationSummary.testSuccess ? '✅' : '❌'}`);
p.log.message(
	`🦾 Accessibility: ${evaluationSummary.a11ySuccess ? '✅' : '❌'}`,
);
p.log.message(
	`⏱️  Duration: ${promptSummary.duration}s (API: ${promptSummary.durationApi}s)`,
);
p.log.message(`💰 Cost: $${promptSummary.cost}`);
p.log.message(`🔄 Turns: ${promptSummary.turns}`);

p.outro('✨ Evaluation complete!');
