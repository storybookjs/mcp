import { parseArgs } from 'node:util';
import * as v from 'valibot';
import * as p from '@clack/prompts';
import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { dedent } from 'ts-dedent';
import { build } from './lib/evaluations/build.ts';
import { checkTypes } from './lib/evaluations/typecheck.ts';
import { runESLint } from './lib/evaluations/lint.ts';
import { setupEvaluations } from './lib/evaluations/setup-evaluations.ts';
import { testStories } from './lib/evaluations/test-stories.ts';
import type { ExperimentArgs } from './types.ts';
import { saveEnvironment } from './lib/evaluations/environment.ts';
import { setupExperiment } from './lib/setup-experiment.ts';
import { x } from 'tinyexec';

const Args = v.pipe(
	v.object({
		values: v.object({
			agent: v.optional(
				v.union([v.literal('claude-code'), v.literal('copilot')]),
			),
			verbose: v.boolean(),
		}),
		positionals: v.array(v.string()),
	}),
	v.transform(({ values, positionals }) => ({
		...values,
		evals: positionals,
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
p.intro('🧪 Storybook MCP Evaluations');

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
		evals: async () => {
			if (parsedArgs.evals.length > 0) {
				return parsedArgs.evals;
			}

			const result = await p.multiselect({
				message: 'Which evals do you want to run?',
				options: evalOptions,
				required: true,
			});

			if (p.isCancel(result)) {
				p.cancel('Operation cancelled.');
				process.exit(0);
			}

			return result as string[];
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
	evals: promptResults.evals,
};

const evalDirsToPaths = Object.fromEntries(
	args.evals.map((evalDir) => [
		evalDir,
		path.resolve(path.join('evals', evalDir)),
	]),
);

// Validate that all eval directories exist
for (const evalPath of Object.values(evalDirsToPaths)) {
	const dirExists = await fs
		.access(evalPath)
		.then(() => true)
		.catch(() => false);
	if (!dirExists) {
		p.log.error(`Eval directory does not exist: ${evalPath}`);
		process.exit(1);
	}
}

const agents = {
	'claude-code': claudeCodeCli,
};

const agent = agents[args.agent as keyof typeof agents];

p.log.info(`Running ${args.evals.length} evaluation(s) with ${args.agent}`);

await Promise.all(
	Object.entries(evalDirsToPaths).map(async ([evalDir, evalPath]) => {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const experimentDirName = `${args.agent}-no-context-${timestamp}`;
		const experimentPath = path.join(
			evalPath,
			'experiments',
			experimentDirName,
		);
		const projectPath = path.join(experimentPath, 'project');
		const resultsPath = path.join(experimentPath, 'results');
		const experimentArgs: ExperimentArgs = {
			evalPath,
			experimentPath,
			projectPath,
			resultsPath,
			verbose: args.verbose,
		};

		p.log.step(`${evalDir}: Starting experiment`);

		await setupExperiment(experimentArgs);

		const prompt = await fs.readFile(path.join(evalPath, 'prompt.md'), 'utf8');
		const enhancedPrompt = dedent`${prompt}
    <constraints>
      IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands. Dependencies have already been installed. Do not run build, test, or dev server commands. Just write the code files.
    </constraints>`;
		const promptResult = await agent.execute({
			prompt: enhancedPrompt,
			env: process.env,
			...experimentArgs,
		});

		await setupEvaluations(experimentArgs);

		const [buildSuccess, typeCheckSuccess, lintSuccess, testResults] =
			await Promise.all([
				build(experimentArgs),
				checkTypes(experimentArgs),
				runESLint(experimentArgs),
				testStories(experimentArgs),
			]);

		const summary = {
			...promptResult,
			buildSuccess,
			typeCheckSuccess,
			lintSuccess,
			testSuccess: testResults.tests,
			a11ySuccess: testResults.a11y,
		};

		await fs.writeFile(
			path.join(resultsPath, 'summary.json'),
			JSON.stringify(summary, null, 2),
		);

		const prettierSpinner = p.spinner();
		prettierSpinner.start('Formatting results');
		await x('pnpm', ['exec', 'prettier', '--write', resultsPath]);
		prettierSpinner.stop('Results formatted');

		p.log.success(`${evalDir}: Evaluation complete`);
		p.log.info('Summary:');
		p.log.message(`🏗️  Build: ${summary.buildSuccess ? '✅' : '❌'}`);
		p.log.message(`🔍 Type Check: ${summary.typeCheckSuccess ? '✅' : '❌'}`);
		p.log.message(`✨ Lint: ${summary.lintSuccess ? '✅' : '❌'}`);
		p.log.message(`🧪 Tests: ${summary.testSuccess ? '✅' : '❌'}`);
		p.log.message(`🦾 Accessibility: ${summary.a11ySuccess ? '✅' : '❌'}`);
		p.log.message(
			`⏱️  Duration: ${promptResult.duration}s (API: ${promptResult.durationApi}s)`,
		);
		p.log.message(`💰 Cost: $${promptResult.cost}`);
		p.log.message(`🔄 Turns: ${promptResult.turns}`);
	}),
);

p.outro('✨ All evaluations complete!');
