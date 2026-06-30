import type { EvalRunData } from '@vercel/agent-eval';
import { describe, expect, test } from 'vitest';
import type { AgentRunAnalysis } from './agent-analysis.ts';
import {
	defineScorer,
	findScorer,
	scoreEvaluation,
	scoringRegistry,
} from './evaluation-scoring.ts';
import { binaryItem, totalScore } from './scoring/types.ts';

function analysis(): AgentRunAnalysis {
	return {
		skillInvocations: [],
		workflow: { browserUrls: [], shellCommands: [] },
		transcript: { totalRawEvents: 0, totalParsedToolCalls: 0, filesRead: [], filesModified: [] },
	};
}

function runData(): EvalRunData {
	return { result: { status: 'passed', duration: 1 }, generatedFiles: {} };
}

describe('scoring system', () => {
	test('defineScorer preserves scorer metadata', () => {
		const scorer = defineScorer({
			fixtureName: 'fixture-a',
			threshold: 80,
			score: () => undefined,
		});

		expect(scorer.fixtureName).toBe('fixture-a');
		expect(scorer.threshold).toBe(80);
	});

	test('totalScore computes the weighted percentage', () => {
		const score = totalScore([
			binaryItem('a', 'A', 0.3, true),
			binaryItem('b', 'B', 0.2, false),
			binaryItem('c', 'C', 0.5, true),
		]);

		// (0.3×1 + 0.2×0 + 0.5×1) / 1.0 = 80%
		expect(score.percent).toBe(80);
		expect(score.items.map(({ id, score }) => ({ id, score }))).toEqual([
			{ id: 'a', score: 1 },
			{ id: 'b', score: 0 },
			{ id: 'c', score: 1 },
		]);
	});

	test('binaryItem attaches details only when provided', () => {
		expect(binaryItem('x', 'X', 1, true)).not.toHaveProperty('details');
		expect(binaryItem('x', 'X', 1, false, { reason: 'no' }).details).toEqual({ reason: 'no' });
	});

	test('registered scorers expose an in-range pass-bar threshold', () => {
		for (const scorer of scoringRegistry) {
			expect(scorer.threshold).toBeGreaterThanOrEqual(0);
			expect(scorer.threshold).toBeLessThanOrEqual(100);
		}
	});

	test('the 922/923 skill fixtures are not scored — they assert via EVAL.ts', () => {
		expect(scoringRegistry).toHaveLength(0);
		expect(findScorer('922-skill-storybook-setup-claude-launch')).toBeUndefined();
		expect(findScorer('923-skill-stories')).toBeUndefined();
	});

	test('does not score a fixture without a registered scorer', () => {
		expect(scoreEvaluation('923-skill-stories', runData(), analysis(), 'claude-code')).toBeUndefined();
	});
});
