import type { ExperimentArgs, McpServerConfig } from '../types.ts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { addDependency, installDependencies } from 'nypm';
import { taskLog } from '@clack/prompts';
import { runHook } from './run-hook.ts';
import { startStorybookDevServer } from './storybook-dev-server.ts';

const STORYBOOK_PACKAGES = [
	'storybook@catalog:',
	'@storybook/addon-a11y@catalog:',
	'@storybook/addon-docs@catalog:',
	'@storybook/addon-vitest@catalog:',
	'@storybook/react-vite@catalog:',
	'@storybook/addon-mcp@workspace:*',
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
		filter: (source) =>
			!source.includes('node_modules') && !source.includes('dist'),
	});

	const packageJsonPath = path.join(experimentArgs.projectPath, 'package.json');
	const { default: packageJson } = await import(packageJsonPath, {
		with: { type: 'json' },
	});
	packageJson.name =
		`@storybook/mcp-eval--${experimentArgs.evalName}--${path.basename(experimentArgs.experimentPath)}`.toLowerCase();

	await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

	log.message('Installing dependencies in project');
	await installDependencies({
		cwd: experimentArgs.projectPath,
		packageManager: 'pnpm',
		silent: true,
	});

	// For storybook-mcp-dev context, install Storybook packages and copy evaluation template
	if (experimentArgs.context.type === 'storybook-mcp-dev') {
		log.message('Setting up Storybook for Storybook Dev MCP context');

		// Copy evaluation template (includes .storybook config with addon-mcp, vitest setup, etc.)
		const evaluationTemplatePath = path.resolve(
			path.join('templates', 'evaluation'),
		);
		await fs.cp(evaluationTemplatePath, experimentArgs.projectPath, {
			recursive: true,
			force: true,
		});

		await fs.writeFile(
			path.join(experimentArgs.projectPath, '.storybook', 'preview.ts'),
			'export default {};\n',
		);

		// Install Storybook packages
		await addDependency(STORYBOOK_PACKAGES, {
			cwd: experimentArgs.projectPath,
			silent: true,
		});

		// Add storybook scripts to package.json
		const sbPackageJsonPath = path.join(
			experimentArgs.projectPath,
			'package.json',
		);
		const { default: sbPackageJson } = await import(sbPackageJsonPath, {
			with: { type: 'json' },
		});
		sbPackageJson.scripts = {
			...sbPackageJson.scripts,
			storybook: 'storybook dev',
			'build-storybook': 'storybook build',
		};
		await fs.writeFile(
			sbPackageJsonPath,
			JSON.stringify(sbPackageJson, null, 2),
		);

		log.message('Storybook packages and config installed');

		// Start Storybook dev server and return MCP config for agent to use
		log.message('Starting Storybook dev server...');
		const devServer = await startStorybookDevServer(experimentArgs.projectPath);
		log.message(`Storybook dev server running on port ${devServer.port}`);

		// Build MCP config for the agent (agent is responsible for writing .mcp.json)
		const mcpServerConfig: McpServerConfig = {
			'storybook-dev-mcp': {
				type: 'http',
				url: `http://localhost:${devServer.port}/mcp`,
			},
		};

		await runHook('post-prepare-experiment', experimentArgs);
		log.success('Experiment prepared');

		return { mcpServerConfig };
	}

	await runHook('post-prepare-experiment', experimentArgs);
	log.success('Experiment prepared');

	return {};
}
