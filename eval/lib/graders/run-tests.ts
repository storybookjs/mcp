import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { x } from 'tinyexec';
import { dedent } from 'ts-dedent';
import type { TrialArgs } from '../../types';

export async function runTests(trialArgs: TrialArgs, testScript: string): Promise<number> {
	const { projectPath, resultsPath } = trialArgs;
	const result = await x('pnpm', [testScript], {
		nodeOptions: { cwd: projectPath },
	});

	await fs.writeFile(
		path.join(resultsPath, 'tests.md'),
		dedent`# Test Results
	
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

	return result.exitCode ?? 0;
}
