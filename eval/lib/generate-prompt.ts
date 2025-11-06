import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Context } from '../types.ts';

const CONSTRAINTS_PROMPT = `<constraints>
  IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands. Dependencies have already been installed. Do not run build, test, or dev server commands. Just write the code files.
</constraints>`;

export async function generatePrompt(
	evalPath: string,
	context: Context,
): Promise<string> {
	const promptParts: string[] = [];
	promptParts.push(await fs.readFile(path.join(evalPath, 'prompt.md'), 'utf8'));
	if (context.type === 'extra-prompts') {
		for (const prompt of context.prompts) {
			const content = await fs.readFile(path.join(evalPath, prompt), 'utf8');
			promptParts.push(content);
		}
	}
	promptParts.push(CONSTRAINTS_PROMPT);

	return promptParts.join('\n');
}
