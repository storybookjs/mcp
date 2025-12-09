import { createServer } from 'node:net';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { addDependency } from 'nypm';
import type { Hooks } from '../../types.ts';
import { log } from '@clack/prompts';
import { x, type Result } from 'tinyexec';

/**
 * Get a random available port by binding to port 0 and then releasing it.
 * Binding to port 0 tells the OS to assign any available port.
 * @see https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
 */
async function getRandomAvailablePort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const address = server.address();
			if (address && typeof address === 'object') {
				const port = address.port;
				server.close(() => resolve(port));
			} else {
				server.close(() => reject(new Error('Failed to get port')));
			}
		});
		server.on('error', reject);
	});
}

/**
 * Wait for Storybook to be ready by listening for the "Storybook ready!" message.
 */
async function waitForStorybook(
	process: Result,
	timeout: number = 10_000,
): Promise<void> {
	return await new Promise<void>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			cleanup();
			reject(new Error('Storybook dev server was not ready in time'));
		}, timeout);

		const onData = (chunk: Buffer) => {
			if (chunk.toString().includes('Storybook ready!')) {
				cleanup();
				resolve();
			}
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(new Error(`Storybook process exited with code ${code}`));
		};

		const cleanup = () => {
			clearTimeout(timeoutId);
			process.process?.stdout?.off('data', onData);
			process.process?.off('exit', onExit);
		};

		process.process?.stdout?.on('data', onData);
		process.process?.on('exit', onExit);
	});
}

const port = await getRandomAvailablePort();
let storybookProcess: Result | undefined;

const hooks: Hooks = {
	postPrepareExperiment: async (experimentArgs) => {
		log.message('Installing Storybook packages and scripts');
		await addDependency(
			[
				'storybook@catalog:',
				'@storybook/addon-a11y@catalog:',
				'@storybook/addon-docs@catalog:',
				'@storybook/addon-vitest@catalog:',
				'@storybook/react-vite@catalog:',
				'@storybook/addon-mcp@workspace:*',
			],
			{
				cwd: experimentArgs.projectPath,
				silent: true,
			},
		);

		// Add storybook dev and build scripts to package.json
		const packageJsonPath = path.join(
			experimentArgs.projectPath,
			'package.json',
		);
		const { default: packageJson } = await import(packageJsonPath, {
			with: { type: 'json' },
		});
		packageJson.scripts = {
			...packageJson.scripts,
			storybook: 'storybook dev',
			'build-storybook': 'storybook build',
		};
		await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

		log.success('Storybook package installed');
	},
	preExecuteAgent: async (experimentArgs) => {
		log.message(`Starting Storybook dev server on port ${port}`);
		storybookProcess = x(
			'pnpm',
			['run', 'storybook', '--port', port.toString(), '--no-open'],
			{
				nodeOptions: {
					cwd: experimentArgs.projectPath,
				},
			},
		);

		log.message('Waiting for Storybook dev server to be ready...');

		await waitForStorybook(storybookProcess);
		log.success('Storybook dev server started');

		if (experimentArgs.context.type === 'components-manifest') {
			/*
			Write MCP config pointing to the Storybook dev server MCP endpoint
			if "Storybook MCP" context is selected. We're essentially overriding
			the default Storybook MCP server with our local dev server.
			*/
			await fs.writeFile(
				path.join(experimentArgs.projectPath, '.mcp.json'),
				JSON.stringify(
					{
						mcpServers: {
							'storybook-dev-mcp': {
								type: 'http',
								url: `http://localhost:${port}/mcp`,
							},
						},
					},
					null,
					2,
				),
			);
		}
	},
	postExecuteAgent: async () => {
		if (storybookProcess) {
			log.message('Stopping Storybook dev server');
			storybookProcess.kill();
			log.success('Storybook dev server stopped');
		}
	},
};

export default hooks;
