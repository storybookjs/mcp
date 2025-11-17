import * as p from '@clack/prompts';
import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import { cloudAgent } from './lib/agents/cloud-agent.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ExperimentArgs } from './types.ts';
import { prepareExperiment } from './lib/prepare-experiment.ts';
import { evaluate } from './lib/evaluations/evaluate.ts';
import { save } from './lib/save/save.ts';
import { collectArgs } from './lib/collect-args.ts';
import { generatePrompt } from './lib/generate-prompt.ts';
import { x } from 'tinyexec';
import { styleText } from 'node:util';
import { showHelp } from './lib/show-help.ts';

// Check for --help flag before any processing
if (process.argv.includes('--help') || process.argv.includes('-h')) {
	showHelp();
}

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

const localDateTimestamp = new Date(
	Date.now() - new Date().getTimezoneOffset() * 60000,
)
	.toISOString()
	.slice(0, 19)
	.replace(/[:.]/g, '-');

let contextPrefix = '';
switch (args.context.type) {
	case false:
		contextPrefix = 'no-context';
		break;
	case 'extra-prompts':
		contextPrefix = args.context.prompts
			.map((prompt) =>
				path.parse(prompt).name.toLowerCase().replace(/\s+/g, '-'),
			)
			.join('-');
		break;
	case 'mcp-server':
		contextPrefix = Object.keys(args.context.mcpServerConfig)
			.map((mcpServerName) => mcpServerName.toLowerCase().replace(/\s+/g, '-'))
			.join('-');
		break;
	case 'components-manifest':
		contextPrefix = 'components-manifest';
		break;
}

const experimentDirName = `${contextPrefix}-${args.agent}-${localDateTimestamp}`;
const experimentPath = path.join(evalPath, 'experiments', experimentDirName);
const projectPath = path.join(experimentPath, 'project');
const resultsPath = path.join(experimentPath, 'results');
const experimentArgs: ExperimentArgs = {
	evalPath,
	experimentPath,
	projectPath,
	resultsPath,
	verbose: args.verbose,
	upload: args.upload,
	evalName: args.eval,
	context: args.context,
	agent: args.agent,
	hooks: await import(path.join(evalPath, 'hooks.ts'))
		.then((mod) => mod.default)
		.catch(() => ({})),
};

p.log.info(`Running experiment '${args.eval}' with agent '${args.agent}'`);

await prepareExperiment(experimentArgs);

const prompt = await generatePrompt(evalPath, args.context);
await fs.writeFile(path.join(experimentPath, 'prompt.md'), prompt);

const agents = {
	'claude-code': claudeCodeCli,
	copilot: cloudAgent,
};
const agent = agents[args.agent as keyof typeof agents];
const promptSummary = await agent.execute(
	prompt,
	experimentArgs,
	args.context.type === 'mcp-server' ||
		args.context.type === 'components-manifest'
		? args.context.mcpServerConfig
		: undefined,
);

const evaluationSummary = await evaluate(experimentArgs);

await fs.writeFile(
	path.join(resultsPath, 'summary.json'),
	JSON.stringify({ ...promptSummary, ...evaluationSummary }, null, 2),
);

p.log.info('Summary:');
p.log.message(`🏗️  Build: ${evaluationSummary.buildSuccess ? '✅' : '❌'}`);
p.log.message(
	`🔍 Type Check: ${evaluationSummary.typeCheckErrors === 0 ? '✅' : styleText('red', `❌ ${evaluationSummary.typeCheckErrors} errors`)}`,
);
p.log.message(
	`✨ Lint: ${evaluationSummary.lintErrors === 0 ? '✅' : styleText('red', `❌ ${evaluationSummary.lintErrors} errors`)}`,
);

if (
	evaluationSummary.test.failed === 0 &&
	evaluationSummary.test.passed === 0
) {
	p.log.message(`🧪 Tests: ❌ ${styleText('red', 'Failed to run')}`);
	p.log.message(`🦾 Accessibility: ⚠️  ${styleText('yellow', 'Inconclusive')}`);
} else if (evaluationSummary.test.failed > 0) {
	p.log.message(
		`🧪 Tests: ${styleText('red', `❌ ${evaluationSummary.test.failed} failed`) + ' | ' + styleText('green', `${evaluationSummary.test.passed} passed`)}`,
	);
	if (evaluationSummary.test.passed > 0) {
		p.log.message(
			`🦾 Accessibility: ⚠️  ${styleText('yellow', `${evaluationSummary.a11y.violations} violations from ${evaluationSummary.test.passed}/${evaluationSummary.test.passed + evaluationSummary.test.failed} tests`)}`,
		);
	} else {
		p.log.message(
			`🦾 Accessibility: ⚠️  ${styleText('yellow', 'Inconclusive')}`,
		);
	}
} else {
	p.log.message('🧪 Tests: ✅');
	p.log.message(
		`🦾 Accessibility: ${evaluationSummary.a11y.violations === 0 ? '✅' : styleText('yellow', `⚠️  ${evaluationSummary.a11y.violations} violations`)}`,
	);
}

p.log.message(
	`⏱️  Duration: ${promptSummary.duration}s (API: ${promptSummary.durationApi}s)`,
);
p.log.message(`💰 Cost: $${promptSummary.cost}`);
p.log.message(`🔄 Turns: ${promptSummary.turns}`);

const chromaticUrl = await save(
	experimentArgs,
	evaluationSummary,
	promptSummary,
);

if (chromaticUrl) {
	p.log.message(
		`🔍 View results at:\n\u001b]8;;${chromaticUrl}\u0007${chromaticUrl}\u001b]8;;\u0007`,
	);
}

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
			cwd: projectPath,
			stdio: 'inherit',
		},
	});
}
