import type { EvalRunData, ExperimentConfig } from '@vercel/agent-eval';
import { analyzeAgentRun } from './agent-analysis.ts';
import { scoreEvaluation, scoreThreshold } from './evaluation-scoring.ts';

export const CLAUDE_STORYBOOK_PLUGIN_EVALS = [
	'922-skill-storybook-setup-claude-launch',
	'923-skill-stories',
] as const;

export const CODEX_STORYBOOK_PLUGIN_EVALS = ['923-skill-stories'] as const;

export function evalRuns(): number {
	const raw = process.env.EVAL_RUNS;
	if (raw === undefined || raw.trim() === '') return 1;

	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`Invalid EVAL_RUNS: "${raw}" (expected a positive integer)`);
	}

	return parsed;
}

function logEvaluation(
	fixtureName: string,
	evaluation: ReturnType<typeof scoreEvaluation>,
	threshold: number,
): void {
	if (!evaluation) return;

	const items = evaluation.items
		.map((item) => `${item.id}=${Math.round(item.score * 100)}%`)
		.join(', ');

	process.stderr.write(
		`[agent-eval] ${fixtureName} score=${evaluation.percent}% (aggregate bar ${threshold}%) (${items})\n`,
	);
}

export function withAgentAnalysis(config: ExperimentConfig): ExperimentConfig {
	return {
		sandbox: 'docker',
		earlyExit: false,
		runs: evalRuns(),
		...config,
		async onRunComplete(context): Promise<EvalRunData> {
			const result = await config.onRunComplete?.(context);
			const runData = result ?? context.runData;
			const agent = analyzeAgentRun(runData, context.config.agent);
			const evaluation = scoreEvaluation(
				context.fixture.name,
				runData,
				agent,
				context.config.agent,
			);

			// No per-run gate: success is the MEAN score across runs, gated on the
			// aggregate by export-results. We just record each run's score and the
			// fixture's aggregate bar (so export-results can read it from result.json).
			const threshold = scoreThreshold(context.fixture.name);
			logEvaluation(context.fixture.name, evaluation, threshold);

			return {
				...runData,
				result: {
					...runData.result,
					analysis: {
						...runData.result.analysis,
						agent,
						evaluation,
						threshold,
						skillInvocations: agent.skillInvocations,
					},
					metadata: {
						...runData.result.metadata,
						evalFixture: context.fixture.name,
					},
				},
			};
		},
	};
}
