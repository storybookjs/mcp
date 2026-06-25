import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

function readTranscriptContext(): {
  o11y?: {
    shellCommands?: Array<{ command: string }>;
  } | null;
} {
  try {
    return JSON.parse(read('__agent_eval__/results.json'));
  } catch {
    return {};
  }
}

function readJson(path: string): unknown {
  return JSON.parse(read(path));
}

const STORYBOOK_PLUGIN_SKILLS = ['init', 'setup', 'stories', 'upgrade'];

describe('storybook plugin skills', () => {
  test('are available for both agent surfaces', () => {
    for (const skill of STORYBOOK_PLUGIN_SKILLS) {
      expect(existsSync(`.agents/skills/${skill}/SKILL.md`)).toBe(true);
      expect(existsSync(`.claude/skills/${skill}/SKILL.md`)).toBe(true);
    }
  });
});

describe('storybook init case', () => {
  test('storybook was initialized with the MCP addon', () => {
    expect(existsSync('.storybook/main.ts') || existsSync('.storybook/main.js')).toBe(true);

    const packageJson = readJson('package.json') as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };

    expect(packageJson.scripts?.storybook).toBeTruthy();
    expect(dependencies.storybook).toBeTruthy();
    expect(dependencies['@storybook/addon-mcp']).toBeTruthy();
  });

  test('init skill was invoked', () => {
    expect(existsSync('.agent-eval/skills/init.json')).toBe(true);
    const marker = readJson('.agent-eval/skills/init.json') as {
      skill?: unknown;
      status?: unknown;
    };

    expect(marker.skill).toBe('init');
    expect(marker.status).toBe('invoked');
  });

  test('agent used the Storybook init workflow', () => {
    const context = readTranscriptContext();
    const commands = context.o11y?.shellCommands?.map(({ command }) => command).join('\n') ?? '';

    expect(commands).toMatch(/(?:create\s+storybook|storybook(?:@[\w.-]+)?\s+init)/i);
    expect(commands).toMatch(/storybook(?:@[\w.-]+)?\s+add\s+@storybook\/addon-mcp/i);
  });
});
