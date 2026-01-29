import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Generates a system prompt by merging selected system.*.md files.
 * @param taskPath Path to the task directory
 * @param systemPromptFiles Array of system prompt file names to merge (e.g., ['system.base.md', 'system.strict.md'])
 * @returns Merged system prompt content
 */
export async function generateSystemPrompt(
	taskPath: string,
	systemPromptFiles: string[],
): Promise<string> {
	const systemParts: string[] = [];

	for (const file of systemPromptFiles) {
		try {
			const content = await fs.readFile(path.join(taskPath, file), 'utf8');
			systemParts.push(content);
		} catch (error) {
			throw new Error(`Failed to read system prompt file ${file}: ${error}`);
		}
	}

	return systemParts.join('\n\n');
}
