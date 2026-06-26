import type { EvalRunData } from '@vercel/agent-eval';
import { describe, expect, test } from 'vitest';
import type { AgentRunAnalysis } from './agent-analysis.ts';
import {
	defineScorer,
	findScorer,
	scoreEvaluation,
	scoringRegistry,
} from './evaluation-scoring.ts';

function analysis(overrides: Partial<AgentRunAnalysis> = {}): AgentRunAnalysis {
	return {
		skillInvocations: [],
		workflow: {
			browserUrls: [],
			shellCommands: [],
		},
		transcript: {
			totalRawEvents: 0,
			totalParsedToolCalls: 0,
			filesRead: [],
			filesModified: [],
		},
		...overrides,
	};
}

function runData(generatedFiles: Record<string, string>): EvalRunData {
	return {
		result: {
			status: 'passed',
			duration: 1,
		},
		generatedFiles,
	};
}

describe('scoreEvaluation', () => {
	test('defineScorer preserves scorer metadata', () => {
		const scorer = defineScorer({
			fixtureName: 'fixture-a',
			threshold: 80,
			score: () => undefined,
		});

		expect(scorer.fixtureName).toBe('fixture-a');
		expect(scorer.threshold).toBe(80);
	});

	test('registered scorers expose a pass-bar threshold', () => {
		for (const scorer of scoringRegistry) {
			expect(scorer.threshold).toBeGreaterThanOrEqual(0);
			expect(scorer.threshold).toBeLessThanOrEqual(100);
		}
	});

	test('registers one scorer per fixture name', () => {
		const fixtureNames = scoringRegistry.map((scorer) => scorer.fixtureName);
		expect(new Set(fixtureNames).size).toBe(fixtureNames.length);
		expect(findScorer('922-skill-storybook-setup-claude-launch')).toBeDefined();
		expect(findScorer('923-skill-stories')).toBeDefined();
	});

	test('does not score fixtures without an explicit scorer', () => {
		const score = scoreEvaluation('unknown-fixture', runData({}), analysis(), 'codex');

		expect(score).toBeUndefined();
	});

	test('scores the former 922 launch-entry rubric', () => {
		const score = scoreEvaluation(
			'922-skill-storybook-setup-claude-launch',
			runData({
				'.claude/launch.json': JSON.stringify({
					configurations: [
						{ name: 'App dev server', command: 'pnpm dev --port $PORT', autoPort: true },
						{ name: 'Storybook', command: 'pnpm storybook --port $PORT', autoPort: true },
					],
				}),
			}),
			analysis(),
			'claude-code',
		);

		expect(score?.percent).toBe(100);
		expect(score?.items).toEqual([
			{
				id: 'storybook-launch-auto-port',
				description: 'Storybook launch entry exists with autoPort: true',
				weight: 1,
				score: 1,
				details: {
					command: 'pnpm storybook --port $PORT',
					autoPort: true,
				},
			},
		]);
	});

	test('scores the former 923 stories weighted rubric', () => {
		const score = scoreEvaluation(
			'923-skill-stories',
			runData({
				'src/components/Badge.stories.tsx': 'export default {};',
				'.agent-eval/preview-browser.json': JSON.stringify({
					source: 'eval-preview-browser-mock',
					status: 'opened',
					url: 'http://localhost:6006/?path=/story/components-badge--default',
				}),
				'.agent-eval/skills/stories.json': JSON.stringify({ skill: 'stories', status: 'invoked' }),
			}),
			analysis({
				skillInvocations: ['stories'],
				workflow: {
					browserUrls: [],
					shellCommands: [
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
						'STORYBOOK_FEATURE_AI_CLI=1 npm run storybook -- --port 6006',
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai preview-stories --port 6006',
					],
				},
			}),
			'claude-code',
		);

		expect(score?.percent).toBe(100);
		expect(score?.items.map(({ id, weight, score }) => ({ id, weight, score }))).toEqual([
			{ id: 'loaded-story-rules', weight: 0.3, score: 1 },
			{ id: 'stories-skill', weight: 0.2, score: 1 },
			{ id: 'wrote-story-file', weight: 0.2, score: 1 },
			{ id: 'opened-preview', weight: 0.3, score: 1 },
		]);
	});

	test('does not count preview-stories as opening the browser preview', () => {
		const score = scoreEvaluation(
			'923-skill-stories',
			runData({
				'src/components/Badge.stories.tsx': 'export default {};',
				'.agent-eval/skills/stories.json': JSON.stringify({ skill: 'stories', status: 'invoked' }),
			}),
			analysis({
				skillInvocations: ['stories'],
				workflow: {
					browserUrls: [],
					shellCommands: [
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai preview-stories --port 6006',
					],
				},
			}),
			'claude-code',
		);

		expect(score?.items.find((item) => item.id === 'opened-preview')).toMatchObject({
			description: 'Opened the Storybook preview through the eval preview-browser mock',
			score: 0,
		});
		expect(score?.percent).toBe(70);
	});

	test('does not count the preview-browser mock unless Storybook was started', () => {
		const score = scoreEvaluation(
			'923-skill-stories',
			runData({
				'src/components/Badge.stories.tsx': 'export default {};',
				'.agent-eval/preview-browser.json': JSON.stringify({
					source: 'eval-preview-browser-mock',
					status: 'opened',
					url: 'http://localhost:6006/?path=/story/components-badge--default',
				}),
				'.agent-eval/skills/stories.json': JSON.stringify({ skill: 'stories', status: 'invoked' }),
			}),
			analysis({
				skillInvocations: ['stories'],
				workflow: {
					browserUrls: [],
					shellCommands: [
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai preview-stories --port 6006',
					],
				},
			}),
			'claude-code',
		);

		expect(score?.items.find((item) => item.id === 'opened-preview')).toMatchObject({
			score: 0,
			details: {
				startedStorybook: false,
			},
		});
		expect(score?.percent).toBe(70);
	});

	test('recognizes Codex when the harness agent id is namespaced', () => {
		const score = scoreEvaluation(
			'923-skill-stories',
			runData({
				'src/components/Badge.stories.tsx': 'export default {};',
			}),
			analysis({
				workflow: {
					browserUrls: ['http://localhost:6006/iframe.html?id=components-badge--default'],
					shellCommands: [
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
						'STORYBOOK_FEATURE_AI_CLI=1 npm run storybook -- --port 6006',
						'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai preview-stories --port 6006',
					],
				},
			}),
			'vercel-ai-gateway/codex',
		);

		expect(score?.items.find((item) => item.id === 'stories-skill')).toMatchObject({
			description: 'Installed Codex stories skill and followed workflow',
			score: 1,
		});
	});
});
