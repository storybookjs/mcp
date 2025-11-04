import { parseArgs } from 'node:util';
import * as v from 'valibot';
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
			agent: v.union([v.literal('claude-code'), v.literal('copilot')]),
			verbose: v.boolean(),
		}),
		positionals: v.array(v.string()),
	}),
	v.transform(({ values, positionals }) => ({
		...values,
		evals: positionals,
	})),
);

const args = v.parse(
	Args,
	parseArgs({
		options: {
			agent: { type: 'string', default: 'claude-code', short: 'a' },
			verbose: { type: 'boolean', default: false, short: 'v' },
		},
		strict: false,
		allowPositionals: true,
		allowNegative: true,
	}),
);

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
		throw new TypeError(`Eval directory does not exist: ${evalPath}`);
	}
}

let agent;

switch (args.agent) {
	case 'claude-code':
	default: {
		agent = claudeCodeCli;
	}
}

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

		console.group(`Running ${evalDir} with ${args.agent}...`);

		console.log('Setting up experiment...');
		await setupExperiment(experimentArgs)

		
		console.log(`Executing prompt with ${args.agent}...`);
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

		console.log('Setting up evaluations...');
		await setupEvaluations(experimentArgs);

		console.log('Starting evaluation...');
		const [buildSuccess, typeCheckSuccess, lintSuccess, { tests, a11y }] =
			await Promise.all([
				build(experimentArgs),
				checkTypes(experimentArgs),
				runESLint(experimentArgs),
				testStories(experimentArgs),
				saveEnvironment(experimentArgs, args.agent),
			]);
		await x('pnpm', ['exec', 'prettier', '--write', resultsPath]);

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
		console.log('Evaluation complete. Summary:');
		console.log(JSON.stringify(summary, null, 2));
	}),
);
