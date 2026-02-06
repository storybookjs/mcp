import { glob, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { installDependencies } from 'nypm';

const trialsPaths = glob('tasks/*/trials');

for await (const trialsPath of trialsPaths) {
	const relativePath = path.relative(process.cwd(), trialsPath);
	try {
		await rm(relativePath, { recursive: true, force: true });
		console.log(`Removed: ${relativePath}`);
	} catch (error) {
		console.error(`Failed to remove ${relativePath}:`, error);
	}
}

console.log('Updating lock file...');
await installDependencies();

console.log('Done!');
