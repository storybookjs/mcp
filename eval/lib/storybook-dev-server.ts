import { createServer } from 'node:net';
import { x, type Result } from 'tinyexec';

/**
 * State for a running Storybook dev server instance.
 */
export type StorybookDevServer = {
	port: number;
	process: Result;
};

let storybookDevServer: StorybookDevServer | undefined;

/**
 * Get a random available port by binding to port 0 and then releasing it.
 * Binding to port 0 tells the OS to assign any available port.
 * @see https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
 */
export async function getRandomAvailablePort(): Promise<number> {
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
export async function waitForStorybook(process: Result, timeout: number = 10_000): Promise<void> {
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

/**
 * Start the Storybook dev server on a random available port.
 * @param projectPath - The path to the project directory
 * @returns The running server state with port and process
 */
export async function startStorybookDevServer(projectPath: string): Promise<StorybookDevServer> {
	const port = await getRandomAvailablePort();

	const process = x('pnpm', ['run', 'storybook', '--port', port.toString(), '--no-open'], {
		nodeOptions: {
			cwd: projectPath,
		},
	});

	await waitForStorybook(process);

	storybookDevServer = { port, process };
	return storybookDevServer;
}

/**
 * Stop the Storybook dev server if it is running.
 */
export function stopStorybookDevServer(): void {
	if (storybookDevServer) {
		storybookDevServer.process.kill();
		storybookDevServer = undefined;
	}
}

/**
 * Get the current Storybook dev server instance, if any.
 */
export function getStorybookDevServer(): StorybookDevServer | undefined {
	return storybookDevServer;
}
