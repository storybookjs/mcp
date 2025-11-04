import { x } from 'tinyexec';
import type { ExperimentArgs } from '../../types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {dedent} from 'ts-dedent';
import * as p from '@clack/prompts';

export async function build({projectPath, resultsPath}: ExperimentArgs): Promise<boolean> {
	const spinner = p.spinner();
	spinner.start('Building project');
	
	const result = await x('pnpm', ['build'], {
		nodeOptions: {
			cwd: projectPath,
		},
	});
	await fs.writeFile(path.join(resultsPath, 'build.md'), dedent`# Build Results
	
	**Exit Code:** ${result.exitCode}

	## stdout
	
	\`\`\`sh
	${result.stdout}
	\`\`\`
	
	## stderr
	
	\`\`\`
	${result.stderr}
	\`\`\`
	`);
	
	const success = result.exitCode === 0;
	spinner.stop(success ? 'Build succeeded' : 'Build failed');
	return success;
}
