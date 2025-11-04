import { parseArgs } from 'node:util';
import * as v from 'valibot';
import * as p from '@clack/prompts';
import { claudeCodeCli } from './lib/agents/claude-code-cli.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { dedent } from 'ts-dedent';
import { installDependencies } from 'nypm';
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
				message: 'Select evaluations to run:',
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
				message: 'Select agent to use:',
				options: [
					{ value: 'claude-code', label: 'Claude Code CLI' },
					{ value: 'copilot', label: 'GitHub Copilot', disabled: true },
				],
			});

			if (p.isCancel(result)) {
				p.cancel('Operation cancelled.');
				process.exit(0);
			}

			return result as 'claude-code' | 'copilot';
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
const s = p.spinner();
s.start('Validating eval directories');
for (const evalPath of Object.values(evalDirsToPaths)) {
	const dirExists = await fs
		.access(evalPath)
		.then(() => true)
		.catch(() => false);
	if (!dirExists) {
		s.stop('Validation failed');
		p.log.error(`Eval directory does not exist: ${evalPath}`);
		process.exit(1);
	}
}
s.stop('All eval directories validated');

let agent;

switch (args.agent) {
	case 'claude-code':
	default: {
		agent = claudeCodeCli;
	}
}

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

		p.log.step(`\n${evalDir}: Starting evaluation`);

		const setupSpinner = p.spinner();
		setupSpinner.start('Setting up experiment');
		await setupExperiment(experimentArgs);
		setupSpinner.stop('Experiment set up');

		const agentSpinner = p.spinner();
		agentSpinner.start(`Executing prompt with ${args.agent}`);
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
		agentSpinner.stop(
			`Agent completed (${promptResult.turns} turns, ${promptResult.duration}s, $${promptResult.cost})`,
		);

		const evalSetupSpinner = p.spinner();
		evalSetupSpinner.start('Setting up evaluations');
		await setupEvaluations(experimentArgs);
		evalSetupSpinner.stop('Evaluations set up');

		const evaluationResults = await p.tasks([
			{
				title: 'Building project',
				task: async () => await build(experimentArgs),
			},
			{
				title: 'Type checking',
				task: async () => await checkTypes(experimentArgs),
			},
			{
				title: 'Linting code',
				task: async () => await runESLint(experimentArgs),
			},
			{
				title: 'Testing stories',
				task: async () => await testStories(experimentArgs),
			},
			{
				title: 'Saving environment',
				task: async () => await saveEnvironment(experimentArgs, args.agent),
			},
		]);

		const [buildSuccess, typeCheckSuccess, lintSuccess, testsResult] =
			evaluationResults;
		const { tests, a11y } = testsResult as { tests: boolean; a11y: boolean };

		const prettierSpinner = p.spinner();
		prettierSpinner.start('Formatting results');
		await x('pnpm', ['exec', 'prettier', '--write', resultsPath]);
		prettierSpinner.stop('Results formatted');

		const summary = {
			...promptResult,
			buildSuccess,
			typeCheckSuccess,
			lintSuccess,
			testSuccess: tests,
			a11ySuccess: a11y,
		};
		await fs.writeFile(
			path.join(resultsPath, 'summary.json'),
			JSON.stringify(summary, null, 2),
		);

		// Log summary with styled output
		p.log.success(`${evalDir}: Evaluation complete`);
		p.log.info('Summary:');
		p.log.message(`  Build: ${buildSuccess ? '✅' : '❌'}`);
		p.log.message(`  Type Check: ${typeCheckSuccess ? '✅' : '❌'}`);
		p.log.message(`  Lint: ${lintSuccess ? '✅' : '❌'}`);
		p.log.message(`  Tests: ${tests ? '✅' : '❌'}`);
		p.log.message(`  A11y: ${a11y ? '✅' : '❌'}`);
		p.log.message(
			`  Duration: ${promptResult.duration}s (API: ${promptResult.durationApi}s, Wall: ${promptResult.durationWall}s)`,
		);
		p.log.message(`  Cost: $${promptResult.cost}`);
		p.log.message(`  Turns: ${promptResult.turns}`);
	}),
);

p.outro('✨ All evaluations complete!');
