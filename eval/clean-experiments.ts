import { glob, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { installDependencies } from 'nypm';

const experimentsPaths = await glob('evals/*/experiments');

for await (const experimentsPath of experimentsPaths) {
	const relativePath = path.relative(process.cwd(), experimentsPath);
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
