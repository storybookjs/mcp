import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function read(path: string): string {
	return readFileSync(path, 'utf-8');
}

function readJson(path: string): unknown {
	return JSON.parse(read(path));
}

function collectConfigs(data: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(data)) {
		return data.filter(
			(item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
		);
	}

	if (data && typeof data === 'object') {
		const record = data as Record<string, unknown>;
		for (const key of ['configurations', 'launches', 'entries', 'launch']) {
			const value = record[key];
			if (Array.isArray(value)) {
				return value.filter(
					(item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
				);
			}
		}
	}

	return [];
}

describe('storybook setup claude launch skill', () => {
	test('is available to Claude Code', () => {
		expect(existsSync('.claude/skills/storybook-setup-claude-launch/SKILL.md')).toBe(true);
	});
});

describe('claude launch configuration', () => {
	test('adds a Storybook launch entry that uses autoPort', () => {
		expect(existsSync('.claude/launch.json')).toBe(true);

		const configs = collectConfigs(readJson('.claude/launch.json'));
		const storybook = configs.find((config) => config.name === 'Storybook');

		expect(storybook).toBeTruthy();
		expect(storybook?.autoPort).toBe(true);
		expect(storybook?.command).toEqual(expect.any(String));
		expect(storybook?.command).toMatch(/storybook/i);
	});

	test('preserves the existing non-Storybook launch entry', () => {
		const configs = collectConfigs(readJson('.claude/launch.json'));
		const appDevServer = configs.find((config) => config.name === 'App dev server');

		expect(appDevServer).toBeTruthy();
		expect(appDevServer?.command).toBe('pnpm dev --port $PORT');
		expect(appDevServer?.autoPort).toBe(true);
	});
});
