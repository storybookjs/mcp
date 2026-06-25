import type { EvalRunData } from '@vercel/agent-eval';
import type { AgentRunAnalysis } from './agent-analysis';

export type EvaluationScoreItem = {
  id: string;
  description: string;
  weight: number;
  score: number;
};

export type EvaluationScore = {
  score: number;
  maxScore: number;
  percent: number;
  items: EvaluationScoreItem[];
};

function parseJson(content: string | undefined): unknown {
  if (!content) return undefined;

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function collectConfigs(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
    );
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['configurations', 'launches', 'entries', 'launch']) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object',
        );
      }
    }
  }

  return [];
}

function item(id: string, description: string, weight: number, passed: boolean): EvaluationScoreItem {
  return {
    id,
    description,
    weight,
    score: passed ? 1 : 0,
  };
}

function total(items: EvaluationScoreItem[]): EvaluationScore {
  const maxScore = items.reduce((sum, result) => sum + result.weight, 0);
  const score = items.reduce((sum, result) => sum + result.weight * result.score, 0);

  return {
    score,
    maxScore,
    percent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
    items,
  };
}

function hasGeneratedFile(runData: EvalRunData, pattern: RegExp): boolean {
  return Object.keys(runData.generatedFiles ?? {}).some((path) => pattern.test(path));
}

function hasCommand(analysis: AgentRunAnalysis, pattern: RegExp): boolean {
  return analysis.workflow.shellCommands.some((command) => pattern.test(command));
}

function scoreClaudeLaunch(runData: EvalRunData): EvaluationScore {
  const launchJson = parseJson(runData.generatedFiles?.['.claude/launch.json']);
  const configs = collectConfigs(launchJson);
  const storybook = configs.find((config) => config.name === 'Storybook');

  return total([
    item(
      'storybook-launch-auto-port',
      'Storybook launch entry exists with autoPort: true',
      1,
      storybook?.autoPort === true,
    ),
  ]);
}

function scoreStories(
  runData: EvalRunData,
  analysis: AgentRunAnalysis,
  agent: string,
): EvaluationScore {
  const loadedStoryRules = hasCommand(analysis, /storybook(?:@[\w.-]+)?\s+ai\b/i);
  const wroteStory = hasGeneratedFile(runData, /\.stories\.(t|j)sx?$/i);
  const openedPreview = hasCommand(analysis, /storybook(?:@[\w.-]+)?\s+ai\s+preview-stories\b/i);
  const invokedStoriesSkill = analysis.skillInvocations.includes('stories');
  const codexFollowedWorkflow =
    agent === 'codex' && loadedStoryRules && wroteStory && openedPreview;

  return total([
    item('loaded-story-rules', 'Loaded story rules via the `storybook ai` CLI', 0.3, loadedStoryRules),
    item(
      'stories-skill',
      agent === 'codex'
        ? 'Installed Codex stories skill and followed workflow'
        : 'Invoked the `stories` skill',
      0.2,
      invokedStoriesSkill || codexFollowedWorkflow,
    ),
    item('wrote-story-file', 'Wrote a `*.stories.*` file', 0.2, wroteStory),
    item('opened-preview', 'Opened a preview via `preview-stories`', 0.3, openedPreview),
  ]);
}

export function scoreEvaluation(
  fixtureName: string,
  runData: EvalRunData,
  analysis: AgentRunAnalysis,
  agent: string,
): EvaluationScore | undefined {
  if (fixtureName === '922-skill-storybook-setup-claude-launch') {
    return scoreClaudeLaunch(runData);
  }

  if (fixtureName === '923-skill-stories') {
    return scoreStories(runData, analysis, agent);
  }

  return undefined;
}
