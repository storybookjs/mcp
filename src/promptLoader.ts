import { readFileSync } from 'fs';
import { join } from 'path';

export function loadPrompt({
    promptFileName,
    subdirectory,
}:{promptFileName: string, subdirectory?: string }): string {
	const promptPath = subdirectory
		? join(process.cwd(), 'prompts', subdirectory, promptFileName)
		: join(process.cwd(), 'prompts', promptFileName);

	try {
		return readFileSync(promptPath, 'utf-8').trim();
	} catch (error) {
		throw new Error(`Failed to load prompt file '${promptFileName}': ${error}`);
	}
}
