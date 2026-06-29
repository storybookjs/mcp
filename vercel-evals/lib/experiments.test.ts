import type { EvalRunData } from '@vercel/agent-eval';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { scoreThreshold } from './evaluation-scoring.ts';
import { evalRuns, withAgentAnalysis } from './experiments.ts';

async function runHook(
	fixtureName: string,
	status: 'passed' | 'failed',
	runDataOverrides: Partial<EvalRunData> = {},
): Promise<EvalRunData> {
	const config = withAgentAnalysis({ agent: 'vercel-ai-gateway/codex' });
	const runData: EvalRunData = {
		result: { status, duration: 1 },
		transcript: '',
		generatedFiles: {},
		...runDataOverrides,
	};

	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const out = await config.onRunComplete!({
		fixture: { name: fixtureName, path: '', prompt: '', isModule: true },
		runIndex: 0,
		// Only `config.agent` is read by the hook.
		config: { agent: 'vercel-ai-gateway/codex' } as never,
		runData,
	});

	return out as EvalRunData;
}

describe('evalRuns', () => {
	const original = process.env.EVAL_RUNS;

	beforeEach(() => {
		delete process.env.EVAL_RUNS;
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.EVAL_RUNS;
		} else {
			process.env.EVAL_RUNS = original;
		}
	});

	test('defaults to 1 when EVAL_RUNS is unset', () => {
		expect(evalRuns()).toBe(1);
	});

	test('defaults to 1 when EVAL_RUNS is empty or whitespace', () => {
		process.env.EVAL_RUNS = '   ';
		expect(evalRuns()).toBe(1);
	});

	test('parses a positive integer', () => {
		process.env.EVAL_RUNS = '5';
		expect(evalRuns()).toBe(5);
	});

	test.each(['0', '-2', '2.5', 'abc'])('throws on invalid value %j', (value) => {
		process.env.EVAL_RUNS = value;
		expect(() => evalRuns()).toThrow(/Invalid EVAL_RUNS/);
	});
});

describe('scoreThreshold', () => {
	const original = process.env.EVAL_SCORE_THRESHOLD;

	beforeEach(() => {
		delete process.env.EVAL_SCORE_THRESHOLD;
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.EVAL_SCORE_THRESHOLD;
		} else {
			process.env.EVAL_SCORE_THRESHOLD = original;
		}
	});

	test('uses each scorer default', () => {
		expect(scoreThreshold('923-skill-stories')).toBe(70);
		expect(scoreThreshold('922-skill-storybook-setup-claude-launch')).toBe(100);
	});

	test('falls back to 100 for an unknown fixture', () => {
		expect(scoreThreshold('unknown-fixture')).toBe(100);
	});

	test('EVAL_SCORE_THRESHOLD overrides every fixture', () => {
		process.env.EVAL_SCORE_THRESHOLD = '85';
		expect(scoreThreshold('923-skill-stories')).toBe(85);
		expect(scoreThreshold('922-skill-storybook-setup-claude-launch')).toBe(85);
	});

	test.each(['-1', '101', 'abc'])('throws on invalid override %j', (value) => {
		process.env.EVAL_SCORE_THRESHOLD = value;
		expect(() => scoreThreshold('923-skill-stories')).toThrow(/Invalid EVAL_SCORE_THRESHOLD/);
	});
});

describe('withAgentAnalysis score recording', () => {
	test('does not change the run status (no per-run gate)', async () => {
		// Empty run → 0% for 923, but success is the aggregate mean, not per-run.
		expect((await runHook('923-skill-stories', 'passed')).result.status).toBe('passed');
		expect((await runHook('923-skill-stories', 'failed')).result.status).toBe('failed');
	});

	test('records the score and aggregate threshold on analysis', async () => {
		const out = await runHook('923-skill-stories', 'passed');
		const analysis = out.result.analysis as {
			threshold?: number;
			evaluation?: { percent: number };
		};

		expect(analysis.threshold).toBe(70);
		expect(analysis.evaluation?.percent).toBe(0);
	});
});
