import type { EvalRunData } from '@vercel/agent-eval';
import type { AgentRunAnalysis } from '../agent-analysis';

export function parseJson(content: string | undefined): unknown {
  if (!content) return undefined;

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

export function parseGeneratedJson(runData: EvalRunData, path: string): unknown {
  return parseJson(runData.generatedFiles?.[path]);
}

export function generatedFilePaths(runData: EvalRunData): string[] {
  return Object.keys(runData.generatedFiles ?? {});
}

export function hasGeneratedFile(runData: EvalRunData, pattern: RegExp): boolean {
  return generatedFilePaths(runData).some((path) => pattern.test(path));
}

export function hasCommand(analysis: AgentRunAnalysis, pattern: RegExp): boolean {
  return analysis.workflow.shellCommands.some((command) => pattern.test(command));
}

export function hasSkillInvocation(analysis: AgentRunAnalysis, skill: string): boolean {
  return analysis.skillInvocations.includes(skill);
}

export function collectObjectList(data: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
    );
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
      );
    }
  }

  return [];
}

export function collectClaudeLaunchConfigs(data: unknown): Array<Record<string, unknown>> {
  return collectObjectList(data, ['configurations', 'launches', 'entries', 'launch']);
}
