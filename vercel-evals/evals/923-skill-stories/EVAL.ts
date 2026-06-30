/// <reference path="../../eval.d.ts" /> 
import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { transcript } from '@vercel/agent-eval/eval';

function shellCommands(): string[] {
	try {
		const ctx = JSON.parse(readFileSync('__agent_eval__/results.json', 'utf-8'));
		return (ctx.o11y?.shellCommands ?? []).map((entry: { command?: string }) => entry.command ?? '');
	} catch {
		return [];
	}
}

function transcriptText(): string {
	try {
		return readFileSync('__agent_eval__/transcript.txt', 'utf-8');
	} catch {
		return '';
	}
}

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules') continue;
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) files.push(...sourceFiles(path));
		else files.push(path);
	}
	return files;
}

test('writes a Storybook story file', () => {
	const stories = sourceFiles('src').filter((path) => /\.stories\.(t|j)sx?$/i.test(path));
	expect(stories.length, 'expected a *.stories.* file under src/').toBeGreaterThan(0);
});

test('loads story rules via the `storybook ai` CLI', () => {
	const ranStorybookAi = shellCommands().some((command) =>
		/storybook(?:@[\w.-]+)?\s+ai\b/i.test(command),
	);
	expect(ranStorybookAi, 'expected a `storybook ai` command in the transcript').toBe(true);
	expect(
		transcriptText(),
		'expected Storybook AI CLI output to include story-writing instructions',
	).toMatch(/# (?:Storybook Setup|Writing User Interfaces)|## How to write good stories/);
});

test('attempts to open the Storybook preview in a browser', async () => {
	await expect(transcript).toSatisfyCriterion(
		'Tried to open the Storybook preview in a browser',
	);
});
