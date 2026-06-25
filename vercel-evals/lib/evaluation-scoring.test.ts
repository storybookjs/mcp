import type { EvalRunData } from '@vercel/agent-eval';
import { describe, expect, test } from 'vitest';
import type { AgentRunAnalysis } from './agent-analysis.js';
import { scoreEvaluation } from './evaluation-scoring.js';

function analysis(overrides: Partial<AgentRunAnalysis> = {}): AgentRunAnalysis {
  return {
    skillInvocations: [],
    workflow: {
      storybookAiCommands: [],
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
      },
    ]);
  });

  test('scores the former 923 stories weighted rubric', () => {
    const score = scoreEvaluation(
      '923-skill-stories',
      runData({
        'src/components/Badge.stories.tsx': 'export default {};',
        '.agent-eval/skills/stories.json': JSON.stringify({ skill: 'stories', status: 'invoked' }),
      }),
      analysis({
        skillInvocations: ['stories'],
        workflow: {
          storybookAiCommands: [
            'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
            'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai preview-stories --port 6006',
          ],
          shellCommands: [
            'STORYBOOK_FEATURE_AI_CLI=1 npx storybook ai --help',
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
});
