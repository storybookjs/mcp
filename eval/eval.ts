import { parseArgs } from 'node:util';
import * as v from 'valibot';
import * as p from '@clack/prompts';
import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { dedent } from 'ts-dedent';
import type { ExperimentArgs } from './types.ts';
import { prepareExperiment } from './lib/prepare-experiment.ts';
import { evaluate } from './lib/evaluations/evaluate.ts';

const Args = v.pipe(
	v.object({
		values: v.object({
			agent: v.optional(
				v.union([v.literal('claude-code'), v.literal('copilot')]),
			),
			verbose: v.boolean(),
		}),
		positionals: v.optional(v.array(v.string())),
	}),
	v.transform(({ values, positionals }) => ({
		...values,
		eval: positionals?.[0],
	})),
);

const parsedArgs = v.parse(
	Args,
	parseArgs({
		options: {
			agent: { type: 'string', short: 'a' },
			verbose: { type: 'boolean', default: false, short: 'v' },
		},
		strict: false,
		allowPositionals: true,
		allowNegative: true,
	}),
);

// Display intro
p.intro('🧪 Storybook MCP Eval');

// Get available eval directories
const evalsDir = path.join(process.cwd(), 'evals');
const availableEvals = await fs.readdir(evalsDir, { withFileTypes: true });
const evalOptions = availableEvals
	.filter((dirent) => dirent.isDirectory())
	.map((dirent) => ({
		value: dirent.name,
		label: dirent.name,
	}));

// Prompt for missing arguments
const promptResults = await p.group(
	{
		eval: async () => {
			if (parsedArgs.eval) {
				return parsedArgs.eval;
			}

			const result = await p.select({
				message: 'Which eval do you want to run?',
				options: evalOptions,
			});

			if (p.isCancel(result)) {
				p.cancel('Operation cancelled.');
				process.exit(0);
			}

			return result as string;
		},
		agent: async () => {
			if (parsedArgs.agent) {
				return parsedArgs.agent;
			}

			const result = await p.select({
				message: 'Which coding agents do you want to use?',
				options: [{ value: 'claude-code', label: 'Claude Code CLI' }],
			});

			if (p.isCancel(result)) {
				p.cancel('Operation cancelled.');
				process.exit(0);
			}

			return result;
		},
		verbose: async () => parsedArgs.verbose,
	},
	{
		onCancel: () => {
			p.cancel('Operation cancelled.');
			process.exit(0);
		},
	},
);

const args = {
	agent: promptResults.agent,
	verbose: promptResults.verbose,
	eval: promptResults.eval,
};

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
};

p.log.info(`Running experiment '${args.eval}' with agent '${args.agent}'`);

await prepareExperiment(experimentArgs);

const prompt = await fs.readFile(path.join(evalPath, 'prompt.md'), 'utf8');
const enhancedPrompt = dedent`${prompt}
<constraints>
  IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands. Dependencies have already been installed. Do not run build, test, or dev server commands. Just write the code files.
</constraints>`;
const promptSummary = await agent.execute({
	prompt: enhancedPrompt,
	env: process.env,
	...experimentArgs,
});

const evaluationSummary = await evaluate(experimentArgs, args.agent);

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
