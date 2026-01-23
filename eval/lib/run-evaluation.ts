import * as p from '@clack/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { styleText } from 'node:util';
import { generatePrompt } from './generate-prompt.ts';
import { generateSystemPrompt } from './generate-system-prompt.ts';
import { prepareExperiment } from './prepare-experiment.ts';
import { teardownExperiment } from './teardown-experiment.ts';
import { evaluate } from './evaluations/evaluate.ts';
import { save } from './save/save.ts';
import type {
	Context,
	EvaluationSummary,
	ExecutionSummary,
	ExperimentArgs,
	SupportedModel,
} from '../types.ts';
import { agents } from '../config.ts';

export type RunEvaluationParams = {
	evalName: string;
	context: Context;
	agent: keyof typeof agents;
	model: SupportedModel;
	systemPrompts: string[];
	uploadId: string | false;
	verbose?: boolean;
	storybook?: boolean;
	runId?: string;
	quiet?: boolean;
};

export type RunEvaluationResult = {
	experimentArgs: ExperimentArgs;
	executionSummary: ExecutionSummary;
	evaluationSummary: EvaluationSummary;
	chromaticUrl?: string;
};

export async function runEvaluation({
	evalName,
	context,
	agent: agentKey,
	model,
	systemPrompts,
	uploadId,
	verbose = false,
	runId,
	quiet = false,
}: RunEvaluationParams): Promise<RunEvaluationResult> {
	const evalPath = path.resolve(path.join('evals', evalName));

	const dirExists = await fs
		.access(evalPath)
		.then(() => true)
		.catch(() => false);

	if (!dirExists) {
		throw new Error(`Eval directory does not exist: ${evalPath}`);
	}

	const localDateTimestamp = new Date(
		Date.now() - new Date().getTimezoneOffset() * 60000,
	)
		.toISOString()
		.slice(0, 19)
		.replace(/[:.]/g, '-');

	const contextPrefix = buildContextPrefix(context);
	const uniqueSuffix = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	const experimentDirName = `${localDateTimestamp}-${uniqueSuffix}-${contextPrefix}-${agentKey}-${model}`;
	const experimentPath = path.join(evalPath, 'experiments', experimentDirName);
	const projectPath = path.join(experimentPath, 'project');
	const resultsPath = path.join(experimentPath, 'results');
	const hooks =
		(await import(path.join(evalPath, 'hooks.ts'))
			.then((mod) => mod.default)
			.catch(() => ({}))) ?? {};

	const experimentArgs: ExperimentArgs = {
		evalPath,
		experimentPath,
		projectPath,
		resultsPath,
		verbose,
		uploadId,
		evalName,
		context,
		agent: agentKey,
		model,
		hooks,
		runId,
	};

	if (!quiet) {
		p.log.info(
			`Running experiment '${evalName}' with agent '${agentKey}' and model '${model}'`,
		);
	}

	const { mcpServerConfig: preparedMcpConfig } =
		await prepareExperiment(experimentArgs);

	const prompt = await generatePrompt(evalPath, context);
	await fs.writeFile(path.join(experimentPath, 'prompt.md'), prompt);

	if (systemPrompts.length > 0) {
		const systemPrompt = await generateSystemPrompt(evalPath, systemPrompts);
		await fs.writeFile(path.join(projectPath, 'Claude.md'), systemPrompt);
	}

	let mergedMcpConfig = preparedMcpConfig;
	for (const ctx of context) {
		if (ctx.type === 'mcp-server') {
			if (!mergedMcpConfig) {
				mergedMcpConfig = {};
			}
			mergedMcpConfig = { ...mergedMcpConfig, ...ctx.mcpServerConfig };
		}
	}

	const agent = agents[agentKey];
	const executionSummary = await agent.execute(
		prompt,
		experimentArgs,
		mergedMcpConfig,
	);

	try {
		await teardownExperiment(experimentArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!quiet) {
			p.log.error(`Failed to teardown experiment: ${message}`);
		}
	}

	const evaluationSummary = await evaluate(experimentArgs);

	await fs.writeFile(
		path.join(resultsPath, 'summary.json'),
		JSON.stringify({ ...executionSummary, ...evaluationSummary }, null, 2),
	);

	if (!quiet) {
		logSummary(executionSummary, evaluationSummary, verbose);
	}

	const chromaticUrl = await save(
		experimentArgs,
		evaluationSummary,
		executionSummary,
	);

	if (!quiet && chromaticUrl) {
		p.log.message(
			`🔍 View results at:\n\u001b]8;;${chromaticUrl}\u0007${chromaticUrl}\u001b]8;;\u0007`,
		);
	}

	return {
		experimentArgs,
		executionSummary,
		evaluationSummary,
		chromaticUrl: chromaticUrl ?? undefined,
	};
}

function buildContextPrefix(context: Context): string {
	if (
		context.length === 0 ||
		(context.length === 1 && context[0]!.type === false)
	) {
		return 'no-context';
	}

	const prefixes: string[] = [];
	for (const ctx of context) {
		if (ctx.type === false) {
			continue;
		}
		switch (ctx.type) {
			case 'extra-prompts':
				prefixes.push(
					ctx.prompts
						.map((prompt) =>
							path.parse(prompt).name.toLowerCase().replace(/\s+/g, '-'),
						)
						.join('-'),
				);
				break;
			case 'inline-prompt':
				prefixes.push('inline');
				break;
			case 'mcp-server':
				prefixes.push(
					Object.keys(ctx.mcpServerConfig)
						.map((mcpServerName) =>
							mcpServerName.toLowerCase().replace(/\s+/g, '-'),
						)
						.join('-'),
				);
				break;
			case 'storybook-mcp-dev':
				prefixes.push('storybook-mcp-dev');
				break;
			case 'storybook-mcp-docs':
				prefixes.push('storybook-mcp-docs');
				break;
		}
	}
	return prefixes.join('-');
}

function logSummary(
	executionSummary: ExecutionSummary,
	evaluationSummary: EvaluationSummary,
	verbose = false,
): void {
	p.log.info('Summary:');
	p.log.message(`🏗️  Build: ${evaluationSummary.buildSuccess ? '✅' : '❌'}`);
	p.log.message(
		`🔍 Type Check: ${
			evaluationSummary.typeCheckErrors === 0
				? '✅'
				: styleText('red', `❌ ${evaluationSummary.typeCheckErrors} errors`)
		}`,
	);
	p.log.message(
		`✨ Lint: ${
			evaluationSummary.lintErrors === 0
				? '✅'
				: styleText('red', `❌ ${evaluationSummary.lintErrors} errors`)
		}`,
	);

	if (
		evaluationSummary.test.failed === 0 &&
		evaluationSummary.test.passed === 0
	) {
		p.log.message(`🧪 Tests: ❌ ${styleText('red', 'Failed to run')}`);
		p.log.message(
			`🦾 Accessibility: ⚠️  ${styleText('yellow', 'Inconclusive')}`,
		);
	} else if (evaluationSummary.test.failed > 0) {
		p.log.message(
			`🧪 Tests: ${
				styleText('red', `❌ ${evaluationSummary.test.failed} failed`) +
				' | ' +
				styleText('green', `${evaluationSummary.test.passed} passed`)
			}`,
		);
		if (evaluationSummary.test.passed > 0) {
			p.log.message(
				`🦾 Accessibility: ${styleText(
					'yellow',
					`${evaluationSummary.a11y.violations} violations from ${evaluationSummary.test.passed}/${evaluationSummary.test.passed + evaluationSummary.test.failed} tests`,
				)}`,
			);
		} else {
			p.log.message(
				`🦾 Accessibility: ⚠️  ${styleText('yellow', 'Inconclusive')}`,
			);
		}
	} else {
		p.log.message('🧪 Tests: ✅');
		p.log.message(
			`🦾 Accessibility: ${
				evaluationSummary.a11y.violations === 0
					? '✅'
					: styleText(
							'yellow',
							`⚠️  ${evaluationSummary.a11y.violations} violations`,
						)
			}`,
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

			if (verbose) {
				p.log.message(
					`📊 Coverage details: lines ${cov.lines ?? '–'}%, statements ${cov.statements ?? '–'}%, branches ${cov.branches ?? '–'}%, functions ${cov.functions ?? '–'}%`,
				);
			}
		}
	}

	p.log.message(
		`⏱️  Duration: ${executionSummary.duration}s (API: ${executionSummary.durationApi}s)`,
	);
	p.log.message(
		`💰 Cost: ${executionSummary.cost ? `$${executionSummary.cost}` : 'unknown'}`,
	);
	p.log.message(`🔄 Turns: ${executionSummary.turns}`);
}
