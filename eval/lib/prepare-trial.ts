import type { TrialArgs, McpServerConfig } from '../types.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDependency, installDependencies } from 'nypm';
import { taskLog } from '@clack/prompts';
import { runHook } from './run-hook.ts';
import { startStorybookDevServer } from './storybook-dev-server.ts';
import { isDevContext, isDocsContext } from './context-utils.ts';

const STORYBOOK_DEV_PACKAGES = [
	'vitest@catalog:trials',
	'@vitest/browser-playwright@catalog:trials',
	'storybook@catalog:trials',
	'@storybook/addon-docs@catalog:trials',
	'@storybook/addon-a11y@catalog:trials',
	'@storybook/addon-mcp@workspace:*',
	'@storybook/addon-vitest@catalog:trials',
	'@storybook/react-vite@catalog:trials',
];

export type PrepareTrialResult = {
	mcpServerConfig?: McpServerConfig;
};

export async function prepareTrial(trialArgs: TrialArgs): Promise<PrepareTrialResult> {
	const log = taskLog({
		title: 'Preparing trial',
		retainLog: trialArgs.verbose,
	});
	await runHook('pre-prepare-trial', trialArgs);

	log.message('Creating project from template');
	await fs.mkdir(path.join(trialArgs.taskPath, 'trials'), {
		recursive: true,
	});
	const projectTemplatePath = path.resolve(path.join('templates', 'project'));
	await fs.mkdir(trialArgs.projectPath, { recursive: true });
	await fs.mkdir(trialArgs.resultsPath, { recursive: true });
	await fs.cp(projectTemplatePath, trialArgs.projectPath, {
		recursive: true,
		filter: (source) => !source.includes('node_modules') && !source.includes('dist'),
	});

	const packageJsonPath = path.join(trialArgs.projectPath, 'package.json');
	const { default: packageJson } = await import(packageJsonPath, {
		with: { type: 'json' },
	});
	packageJson.name =
		`@storybook/mcp-task--${trialArgs.taskName}--${path.basename(trialArgs.trialPath)}`.toLowerCase();

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	let result: PrepareTrialResult = {
		mcpServerConfig: {},
	};

	if (isDevContext(trialArgs.context)) {
		packageJson.scripts = {
			...packageJson.scripts,
			storybook: 'storybook dev',
			'build-storybook': 'storybook build',
		};
	}

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	log.message('Installing dependencies in project');
	await installDependencies({
		cwd: trialArgs.projectPath,
		packageManager: 'pnpm',
		silent: true,
	});

	if (isDocsContext(trialArgs.context)) {
		result.mcpServerConfig!['storybook-docs-mcp'] = {
			type: 'stdio',
			command: 'node',
			args: [
				path.join(process.cwd(), '..', 'packages', 'mcp', 'bin.ts'),
				'--manifestsDir',
				path.join(trialArgs.taskPath, 'manifests'),
			],
		};
	}

	if (isDevContext(trialArgs.context)) {
		log.message('Setting up Storybook for Storybook Dev MCP context');

		// Copy grading template (includes .storybook config with addon-mcp, vitest setup, etc.)
		const gradingTemplatePath = path.resolve(path.join('templates', 'grading'));
		await fs.cp(gradingTemplatePath, trialArgs.projectPath, {
			recursive: true,
			force: true,
			filter: (source) =>
				// Only include coverage docs once coverage JSON exists; otherwise Storybook will
				// error on the static imports inside `results/coverage.mdx`.
				!source.endsWith(path.join('results', 'coverage.mdx')) &&
				// Only include judge docs once judge JSON exists.
				!source.endsWith(path.join('results', 'judge.mdx')),
		});

		// Install packages required for a Storybook dev setup
		await addDependency(STORYBOOK_DEV_PACKAGES, {
			cwd: trialArgs.projectPath,
			silent: true,
		});

		log.message('Storybook packages and config installed');
		log.message('Starting Storybook dev server...');
		const devServer = await startStorybookDevServer(trialArgs.projectPath);
		log.message(`Storybook dev server running on port ${devServer.port}`);

		result.mcpServerConfig!['storybook-dev-mcp'] = {
			type: 'http',
			url: `http://localhost:${devServer.port}/mcp`,
		};
	}

	await runHook('post-prepare-trial', trialArgs);
	log.success('Trial prepared');

	return result;
}
