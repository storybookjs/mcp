import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addDependency } from 'nypm';
import type { Hooks } from '../../types.ts';
import { log } from '@clack/prompts';
import { x, type Result } from 'tinyexec';

/**
 * Get a random available port by binding to port 0 and then releasing it.
 */
async function getRandomAvailablePort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
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
	return promise;
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
		const packageJsonPath = join(experimentArgs.projectPath, 'package.json');
		const { default: packageJson } = await import(packageJsonPath, {
			with: { type: 'json' },
		});
		packageJson.scripts = {
			...packageJson.scripts,
			storybook: 'storybook dev',
			'build-storybook': 'storybook build',
		};
		await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

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

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const timeout = setTimeout(() => {
			reject(new Error('Storybook dev server was not ready in time'));
		}, 10_000);

		storybookProcess.process?.stdout?.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes('Storybook ready!')) {
				clearTimeout(timeout);
				resolve();
			}
		});
		storybookProcess.process?.on('exit', (code) => {
			clearTimeout(timeout);
			reject(new Error(`Storybook process exited with code ${code}`));
		});

		await promise;
		log.success('Storybook dev server started');
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
