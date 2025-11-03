import { parseArgs } from 'node:util';
import * as v from 'valibot';
import { claudeCodeCli } from './agents/claude-code-cli.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { dedent } from 'ts-dedent';
import { installDependencies } from 'nypm';
import { build } from './lib/build.ts';
import { typeCheck } from './lib/typecheck.ts';
import { runESLint } from './lib/lint.ts';

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
		const outputDirName = `${args.agent}-no-context-${timestamp}`;
		const outputDir = path.join(evalPath, 'outputs', outputDirName);

		console.group(`Running ${evalDir} with ${args.agent}...`);
		console.log(`Setting up output directory at '${outputDir}'`);
		// Create outputs directory if it doesn't exist
		await fs.mkdir(path.join(evalPath, 'outputs'), { recursive: true });

		// Copy template-project to output directory, excluding node_modules
		const templateDir = path.resolve('template-project');
		await fs.mkdir(path.join(evalPath, 'outputs'), { recursive: true });
		await fs.cp(templateDir, outputDir, {
			recursive: true,
			filter: (src) => !src.includes('node_modules'),
		});

		console.log('Installing dependencies in output directory...');
		await installDependencies({
			cwd: outputDir,
			packageManager: 'pnpm',
			silent: !args.verbose,
		});

		const prompt = await fs.readFile(path.join(evalPath, 'prompt.md'), 'utf8');

		const enhancedPrompt = dedent`${prompt}

    <constraints>
      IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands. Dependencies have already been installed. Do not run build, test, or dev server commands. Just write the code files.
    </constraints>`;

		console.log(`Executing prompt with ${args.agent}...`);
		const promptResult = await agent.execute({
			prompt: enhancedPrompt,
			projectDir: outputDir,
			env: process.env as Record<string, string>,
		});
		console.log(promptResult);

		console.log('Starting evaluation...');

		const [buildSucceeded, typeCheckResults, lintResults] = await Promise.all([
			build(outputDir),
			typeCheck(path.join(outputDir, 'tsconfig.app.json')),
			runESLint(outputDir),
		]);

		console.log(
			JSON.stringify(
				{
					buildSucceeded,
					typeCheckSucceeded: typeCheckResults.success,
					lintSucceeded: lintResults.structured.success,
				},
				null,
				2,
			),
		);
	}),
);
