import type { ExperimentArgs } from '../../types.ts';
import { runScript } from 'nypm';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dedent } from 'ts-dedent';
import { x } from 'tinyexec';

const CHROMATIC_PROJECT_TOKEN = 'chpt_db38f014a63ef87';

type ChromaticDiagnostics = {
	storybookUrl?: string;
	webUrl?: string;
};

export async function buildStorybook(
	experimentArgs: ExperimentArgs,
): Promise<boolean> {
	const { projectPath, resultsPath } = experimentArgs;

	let buildSuccess = false;
	let buildOutput = '';
	let buildError = '';

	try {
		await runScript('eval:build-storybook', {
			cwd: projectPath,
			silent: true,
		});
		buildSuccess = true;
		buildOutput = 'Build completed successfully';
	} catch (error) {
		buildSuccess = false;
		buildError = error instanceof Error ? error.message : String(error);
	}

	await fs.writeFile(
		path.join(resultsPath, 'build-storybook.md'),
		dedent`# Build Storybook Results
	
		**Success:** ${buildSuccess}

		## Output
		
		\`\`\`sh
		${buildOutput}
		\`\`\`
		
		## Errors
		
		\`\`\`
		${buildError}
		\`\`\`
		`,
	);

	if (!buildSuccess) {
		return false;
	}

	const storybookStaticPath = path.join(projectPath, 'storybook-static');
	const storybookResultsPath = path.join(storybookStaticPath, 'results');

	await fs.mkdir(storybookResultsPath, { recursive: true });
	await fs.cp(resultsPath, storybookResultsPath, {
		recursive: true,
		force: true,
	});
	return true;
}

export async function uploadToChromatic(
	experimentArgs: ExperimentArgs,
): Promise<string | undefined> {
	await x(
		'npx',
		[
			'chromatic',
			'--project-token',
			CHROMATIC_PROJECT_TOKEN,
			'--exit-zero-on-changes',
			'--storybook-build-dir',
			'storybook-static',
			'--diagnostics-file',
			'chromatic-diagnostics.json',
		],
		{
			nodeOptions: {
				cwd: experimentArgs.projectPath,
			},
		},
	);

	const diagnosticsPath = path.join(
		experimentArgs.projectPath,
		'chromatic-diagnostics.json',
	);
	const { default: diagnostics } = (await import(diagnosticsPath, {
		with: { type: 'json' },
	})) as { default: ChromaticDiagnostics };

	return diagnostics.storybookUrl;
}
