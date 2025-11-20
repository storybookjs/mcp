import { x } from 'tinyexec';
import type { ExperimentArgs } from '../../types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dedent } from 'ts-dedent';

export async function build({
	projectPath,
	resultsPath,
}: ExperimentArgs): Promise<boolean> {
	const result = await x('pnpm', ['eval:build'], {
		nodeOptions: {
			cwd: projectPath,
		},
	});
	await fs.writeFile(
		path.join(resultsPath, 'build.md'),
		dedent`# Build Results
	
	**Exit Code:** ${result.exitCode}

	## stdout
	
	\`\`\`sh
	${result.stdout}
	\`\`\`
	
	## stderr
	
	\`\`\`
	${result.stderr}
	\`\`\`
	`,
	);

	return result.exitCode === 0;
}
