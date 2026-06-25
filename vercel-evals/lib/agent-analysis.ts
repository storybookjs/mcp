import { parseTranscript, type EvalRunData } from '@vercel/agent-eval';
import { parseJsonl } from './utils.js';

export type AgentRunAnalysis = {
  skillInvocations: string[];
  workflow: {
    storybookAiCommands: string[];
    shellCommands: string[];
  };
  transcript: {
    totalRawEvents: number;
    totalParsedToolCalls: number;
    filesRead: string[];
    filesModified: string[];
  };
};

export function hasSkillInvocation(
  analysis: Pick<AgentRunAnalysis, 'skillInvocations'>,
  skill: string,
): boolean {
  return analysis.skillInvocations.includes(skill);
} 
function commandFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;

  const record = event as {
    item?: { type?: unknown; command?: unknown };
    tool?: { args?: Record<string, unknown> };
  };

  if (record.item?.type === 'command_execution' && typeof record.item.command === 'string') {
    return record.item.command;
  }

  const command = record.tool?.args?._extractedCommand ?? record.tool?.args?.command;
  return typeof command === 'string' ? command : undefined;
}

function parseGeneratedJson(files: Record<string, string> | undefined, path: string): unknown {
  const content = files?.[path];
  if (!content) return undefined;

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function skillFromMarker(path: string, marker: unknown): string | undefined {
  if (marker && typeof marker === 'object') {
    const skill = (marker as { skill?: unknown }).skill;
    if (typeof skill === 'string' && skill.trim()) {
      return skill;
    }
  }

  const genericMatch = path.match(/^\.agent-eval\/skills\/([^/]+)\.json$/);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  const legacyMatch = path.match(/^\.agent-eval\/skill-([a-z0-9-]+)-invoked\.json$/i);
  return legacyMatch?.[1];
}

export function analyzeAgentRun(runData: EvalRunData, agent: string): AgentRunAnalysis {
  const rawEvents = parseJsonl(runData.transcript);
  const parsed = runData.transcript ? parseTranscript(runData.transcript, agent) : undefined;
  const shellCommands = [
    ...(parsed?.summary.shellCommands.map(({ command }) => command) ?? []),
    ...rawEvents.map(commandFromEvent).filter((command): command is string => Boolean(command)),
  ];
  const uniqueCommands = [...new Set(shellCommands)];
  const generatedFiles = runData.generatedFiles ?? {};
  const skillInvocations = Object.keys(generatedFiles)
    .filter((path) =>
      /^\.agent-eval\/skills\/[^/]+\.json$/.test(path) ||
      /^\.agent-eval\/skill-[a-z0-9-]+-invoked\.json$/i.test(path),
    )
    .map((path) => skillFromMarker(path, parseGeneratedJson(generatedFiles, path)))
    .filter((skill): skill is string => Boolean(skill))
    .filter((skill, index, skills) => skills.indexOf(skill) === index)
    .sort();

  return {
    skillInvocations,
    workflow: {
      storybookAiCommands: uniqueCommands.filter((command) =>
        /storybook(?:@[\w.-]+)?\s+ai\b/i.test(command),
      ),
      shellCommands: uniqueCommands,
    },
    transcript: {
      totalRawEvents: rawEvents.length,
      totalParsedToolCalls: parsed?.summary.totalToolCalls ?? 0,
      filesRead: parsed?.summary.filesRead ?? [],
      filesModified: parsed?.summary.filesModified ?? [],
    },
  };
}
