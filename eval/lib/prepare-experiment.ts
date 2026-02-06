import type { ExperimentArgs, McpServerConfig } from '../types.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDependency, installDependencies } from 'nypm';
import { taskLog } from '@clack/prompts';
import { runHook } from './run-hook.ts';
import { startStorybookDevServer } from './storybook-dev-server.ts';
import { isDevEvaluation, isDocsEvaluation } from './context-utils.ts';

const STORYBOOK_DEV_PACKAGES = [
	'vitest@catalog:experiments',
	'@vitest/browser-playwright@catalog:experiments',
	'storybook@catalog:experiments',
	'@storybook/addon-docs@catalog:experiments',
	'@storybook/addon-a11y@catalog:experiments',
	'@storybook/addon-mcp@workspace:*',
	'@storybook/addon-vitest@catalog:experiments',
	'@storybook/react-vite@catalog:experiments',
];

export type PrepareExperimentResult = {
	mcpServerConfig?: McpServerConfig;
};

export async function prepareExperiment(
	experimentArgs: ExperimentArgs,
): Promise<PrepareExperimentResult> {
	const log = taskLog({
		title: 'Preparing experiment',
		retainLog: experimentArgs.verbose,
	});
	await runHook('pre-prepare-experiment', experimentArgs);

	log.message('Creating project from template');
	await fs.mkdir(path.join(experimentArgs.evalPath, 'experiments'), {
		recursive: true,
	});
	const projectTemplatePath = path.resolve(path.join('templates', 'project'));
	await fs.mkdir(experimentArgs.projectPath, { recursive: true });
	await fs.mkdir(experimentArgs.resultsPath, { recursive: true });
	await fs.cp(projectTemplatePath, experimentArgs.projectPath, {
		recursive: true,
		filter: (source) => !source.includes('node_modules') && !source.includes('dist'),
	});

	const packageJsonPath = path.join(experimentArgs.projectPath, 'package.json');
	const { default: packageJson } = await import(packageJsonPath, {
		with: { type: 'json' },
	});
	packageJson.name =
		`@storybook/mcp-eval--${experimentArgs.evalName}--${path.basename(experimentArgs.experimentPath)}`.toLowerCase();

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	let result: PrepareExperimentResult = {
		mcpServerConfig: {},
	};

	if (isDevEvaluation(experimentArgs.context)) {
		packageJson.scripts = {
			...packageJson.scripts,
			storybook: 'storybook dev',
			'build-storybook': 'storybook build',
		};
	}

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	log.message('Installing dependencies in project');
	await installDependencies({
		cwd: experimentArgs.projectPath,
		packageManager: 'pnpm',
		silent: true,
	});

	if (isDocsEvaluation(experimentArgs.context)) {
		result.mcpServerConfig!['storybook-docs-mcp'] = {
			type: 'stdio',
			command: 'node',
			args: [
				path.join(process.cwd(), '..', 'packages', 'mcp', 'bin.ts'),
				'--manifestsDir',
				experimentArgs.evalPath,
			],
		};
	}

	if (isDevEvaluation(experimentArgs.context)) {
		log.message('Setting up Storybook for Storybook Dev MCP context');

		// Copy evaluation template (includes .storybook config with addon-mcp, vitest setup, etc.)
		const evaluationTemplatePath = path.resolve(path.join('templates', 'evaluation'));
		await fs.cp(evaluationTemplatePath, experimentArgs.projectPath, {
			recursive: true,
			force: true,
			filter: (source) =>
				// Only include coverage docs once coverage JSON exists; otherwise Storybook will
				// error on the static imports inside `results/coverage.mdx`.
				!source.endsWith(path.join('results', 'coverage.mdx')),
		});

		await fs.writeFile(
			path.join(experimentArgs.projectPath, '.storybook', 'preview.ts'),
			'export default {};\n',
		);

		// Install packages required for a Storybook dev setup
		await addDependency(STORYBOOK_DEV_PACKAGES, {
			cwd: experimentArgs.projectPath,
			silent: true,
		});

		log.message('Storybook packages and config installed');
		log.message('Starting Storybook dev server...');
		const devServer = await startStorybookDevServer(experimentArgs.projectPath);
		log.message(`Storybook dev server running on port ${devServer.port}`);

		result.mcpServerConfig!['storybook-dev-mcp'] = {
			type: 'http',
			url: `http://localhost:${devServer.port}/mcp`,
		};
	}

	await runHook('post-prepare-experiment', experimentArgs);
	log.success('Experiment prepared');

	return result;
}
