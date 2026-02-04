import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Context } from '../types.ts';
import { log } from '@clack/prompts';

const CONSTRAINTS_PROMPT = `<constraints>
  IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands. Dependencies have already been installed. Do not run build, test, or dev server commands. Just write the code files.
</constraints>`;

export async function generatePrompt(taskPath: string, context: Context): Promise<string> {
	const promptParts: string[] = [];

	try {
		const content = await fs.readFile(path.join(taskPath, 'prompt.md'), 'utf8');
		promptParts.push(content);
	} catch {
		log.warn(`prompt.md not found, skipping`);
	}

	// Collect all extra prompts from all contexts
	for (const ctx of context) {
		if (ctx.type === 'extra-prompts') {
			for (const prompt of ctx.prompts) {
				const content = await fs.readFile(path.join(taskPath, prompt), 'utf8');
				promptParts.push(content);
			}
		} else if (ctx.type === 'inline-prompt') {
			promptParts.push(ctx.content);
		}
	}

	promptParts.push(CONSTRAINTS_PROMPT);

	return promptParts.join('\n');
}
