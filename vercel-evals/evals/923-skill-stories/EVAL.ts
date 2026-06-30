import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

type ShellCommand = { command?: string };

function shellCommands(): string[] {
	let context: { o11y?: { shellCommands?: ShellCommand[] } | null };
	try {
		context = JSON.parse(readFileSync('__agent_eval__/results.json', 'utf-8'));
	} catch {
		return [];
	}
	return (context.o11y?.shellCommands ?? []).map((entry) => entry.command ?? '');
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
});
