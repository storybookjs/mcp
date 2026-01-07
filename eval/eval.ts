import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ExperimentArgs, McpServerConfig } from './types.ts';
import { prepareExperiment } from './lib/prepare-experiment.ts';
import { teardownExperiment } from './lib/teardown-experiment.ts';
import { evaluate } from './lib/evaluations/evaluate.ts';
import { save } from './lib/save/save.ts';
import { collectArgs } from './lib/collect-args.ts';
import { generatePrompt } from './lib/generate-prompt.ts';
import { generateSystemPrompt } from './lib/generate-system-prompt.ts';
import { x } from 'tinyexec';
import { styleText } from 'node:util';
import { agents } from './config.ts';

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
if (
	args.context.length === 0 ||
	(args.context.length === 1 && args.context[0]!.type === false)
) {
	contextPrefix = 'no-context';
} else {
	const prefixes: string[] = [];
	for (const context of args.context) {
		if (context.type === false) {
			continue;
		}
		switch (context.type) {
			case 'extra-prompts':
				prefixes.push(
					context.prompts
						.map((prompt) =>
							path.parse(prompt).name.toLowerCase().replace(/\s+/g, '-'),
						)
						.join('-'),
				);
				break;
			case 'mcp-server':
				prefixes.push(
					Object.keys(context.mcpServerConfig)
						.map((mcpServerName) =>
							mcpServerName.toLowerCase().replace(/\s+/g, '-'),
						)
						.join('-'),
				);
				break;
			case 'components-manifest':
				prefixes.push('components-manifest');
				break;
			case 'storybook-mcp-dev':
				prefixes.push('storybook-mcp-dev');
				break;
		}
	}
	contextPrefix = prefixes.join('-');
}

const experimentDirName = `${contextPrefix}-${args.agent}-${args.model}-${localDateTimestamp}`;
const experimentPath = path.join(evalPath, 'experiments', experimentDirName);
const projectPath = path.join(experimentPath, 'project');
const resultsPath = path.join(experimentPath, 'results');
const experimentArgs: ExperimentArgs = {
	evalPath,
	experimentPath,
	projectPath,
	resultsPath,
	verbose: args.verbose,
	uploadId: args.uploadId,
	evalName: args.eval,
	context: args.context,
	agent: args.agent,
	model: args.model,
	hooks: await import(path.join(evalPath, 'hooks.ts'))
		.then((mod) => mod.default)
		.catch(() => ({})),
};

p.log.info(
	`Running experiment '${args.eval}' with agent '${args.agent}' and model '${args.model}'`,
);

const { mcpServerConfig: preparedMcpConfig } =
	await prepareExperiment(experimentArgs);

const prompt = await generatePrompt(evalPath, args.context);
await fs.writeFile(path.join(experimentPath, 'prompt.md'), prompt);

// Generate and write system prompt to Claude.md if system prompts are selected
if (args.systemPrompts.length > 0) {
	const systemPrompt = await generateSystemPrompt(evalPath, args.systemPrompts);
	await fs.writeFile(path.join(projectPath, 'Claude.md'), systemPrompt);
}

// Merge all MCP server configs from contexts
let mergedMcpConfig: McpServerConfig | undefined = preparedMcpConfig;
for (const context of args.context) {
	if (context.type === 'mcp-server' || context.type === 'components-manifest') {
		if (!mergedMcpConfig) {
			mergedMcpConfig = {};
		}
		mergedMcpConfig = { ...mergedMcpConfig, ...context.mcpServerConfig };
	}
}

const agent = agents[args.agent];
const promptSummary = await agent.execute(
	prompt,
	experimentArgs,
	mergedMcpConfig,
);

try {
	await teardownExperiment(experimentArgs);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	p.log.error(`Failed to teardown experiment: ${message}`);
	// Continue with evaluation despite teardown failure
}

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

const cov = evaluationSummary.coverage;
const COVERAGE_THRESHOLDS = {
	failBelow: 70,
	warnBelow: 90,
} as const;

const formatPct = (v: number) => `${Math.round(v)}`;
const isNumber = (v: unknown): v is number => typeof v === 'number';

const getCoverageBadge = (v: number) => {
	return v >= COVERAGE_THRESHOLDS.warnBelow
		? '✅'
		: v >= COVERAGE_THRESHOLDS.failBelow
			? '⚠️'
			: '❌';
};

if (cov) {
	if (isNumber(cov.lines)) {
		const overall = cov.lines;
		const badge = getCoverageBadge(overall);

		p.log.message(`Coverage: ${badge} ${formatPct(overall)} %`);

		if (args.verbose) {
			p.log.message(
				`📊 Coverage details: lines ${cov.lines ?? '–'}%, statements ${cov.statements ?? '–'}%, branches ${cov.branches ?? '–'}%, functions ${cov.functions ?? '–'}%`,
			);
		}
	}
}

p.log.message(
	`⏱️  Duration: ${promptSummary.duration}s (API: ${promptSummary.durationApi}s)`,
);
p.log.message(
	`💰 Cost: ${promptSummary.cost ? `$${promptSummary.cost}` : 'unknown'}`,
);
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
