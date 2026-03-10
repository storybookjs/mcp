import { fileURLToPath } from 'node:url';
import { x } from 'tinyexec';

export const STORYBOOK_DIR = fileURLToPath(new URL('..', import.meta.url));
type StorybookProcess = ReturnType<typeof x>;

export function createMCPRequestBody(method: string, params: any = {}, id: number = 1) {
	return {
		jsonrpc: '2.0',
		id,
		method,
		params,
	};
}

export async function parseMCPResponse(response: Response) {
	const text = await response.text();
	const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
	const jsonText = dataLine!.replace(/^data: /, '').trim();
	return JSON.parse(jsonText);
}

export async function waitForMcpEndpoint(
	endpoint: string,
	options: {
		maxAttempts?: number;
		interval?: number;
		acceptStatuses?: number[];
		debugLabel?: string;
		storybookProcess?: StorybookProcess | null;
	} = {},
): Promise<void> {
	const {
		maxAttempts = 120,
		interval = 500,
		acceptStatuses = [],
		debugLabel = 'mcp',
		storybookProcess,
	} = options;
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	let attempts = 0;
	let lastStatus: number | null = null;
	let lastErrorMessage: string | null = null;

	const intervalId = setInterval(async () => {
		attempts++;
		try {
			const storybookPid = storybookProcess?.process?.pid;
			const storybookExitCode = storybookProcess?.process?.exitCode;
			if (storybookPid && storybookExitCode !== null) {
				clearInterval(intervalId);
				reject(
					new Error(
						`[${debugLabel}] Storybook exited before MCP became ready (pid=${storybookPid}, exitCode=${storybookExitCode})`,
					),
				);
				return;
			}

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(createMCPRequestBody('tools/list')),
			});
			lastStatus = response.status;
			console.log(
				`[${debugLabel}] MCP probe #${attempts}/${maxAttempts}: status=${response.status}`,
			);
			if (response.ok || acceptStatuses.includes(response.status)) {
				clearInterval(intervalId);
				console.log(
					`[${debugLabel}] MCP endpoint ready after ${attempts} probes (status=${response.status})`,
				);
				resolve();
				return;
			}
		} catch (error) {
			lastErrorMessage = error instanceof Error ? error.message : String(error);
			console.log(`[${debugLabel}] MCP probe #${attempts}/${maxAttempts}: ${lastErrorMessage}`);
		}

		if (attempts >= maxAttempts) {
			clearInterval(intervalId);
			reject(
				new Error(
					`[${debugLabel}] MCP endpoint failed to start in time (attempts=${attempts}, lastStatus=${lastStatus ?? 'none'}, lastError=${lastErrorMessage ?? 'none'})`,
				),
			);
		}
	}, interval);

	return promise;
}

export async function killPort(port: number): Promise<void> {
	try {
		if (process.platform === 'win32') {
			await x('npx', ['kill-port', String(port)]);
		} else {
			const { stdout } = await x('lsof', ['-ti', `:${port}`]);
			if (stdout.trim()) {
				await x('kill', ['-9', ...stdout.trim().split('\n')]);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch {
		// No process on port, continue
	}
}

export function startStorybook(configDir: string, port: number): ReturnType<typeof x> {
	return x('pnpm', ['storybook', '--config-dir', configDir, '--port', String(port)], {
		nodeOptions: {
			cwd: STORYBOOK_DIR,
		},
	});
}

export function attachStorybookDebugLogging(
	storybookProcess: StorybookProcess | null,
	label: string,
): void {
	if (!storybookProcess?.process) {
		console.log(`[${label}] Storybook process missing`);
		return;
	}
	const proc = storybookProcess.process;
	console.log(`[${label}] Storybook started (pid=${proc.pid ?? 'unknown'})`);
	proc.stdout?.setEncoding('utf8');
	proc.stderr?.setEncoding('utf8');
	proc.stdout?.on('data', (chunk: string) => {
		for (const line of chunk.split('\n')) {
			if (line.trim()) {
				console.log(`[${label}] stdout: ${line}`);
			}
		}
	});
	proc.stderr?.on('data', (chunk: string) => {
		for (const line of chunk.split('\n')) {
			if (line.trim()) {
				console.log(`[${label}] stderr: ${line}`);
			}
		}
	});
	proc.on('exit', (code, signal) => {
		console.log(`[${label}] Storybook exited (code=${code}, signal=${signal ?? 'none'})`);
	});
	proc.on('error', (error) => {
		console.log(`[${label}] Storybook process error: ${error.message}`);
	});
}

export async function stopStorybook(storybookProcess: ReturnType<typeof x> | null): Promise<void> {
	if (!storybookProcess || !storybookProcess.process) {
		return;
	}
	const processToStop = storybookProcess.process;
	if (processToStop.exitCode !== null || !processToStop.pid) {
		return;
	}

	const waitForExit = Promise.withResolvers<void>();
	processToStop.once('exit', () => waitForExit.resolve());

	storybookProcess.kill('SIGTERM');
	const timeout = setTimeout(async () => {
		try {
			if (process.platform === 'win32') {
				await x('taskkill', ['/pid', String(processToStop.pid), '/t', '/f']);
			} else {
				processToStop.kill('SIGKILL');
			}
		} catch {
			// Process may already be gone.
		}
	}, 5_000);

	await waitForExit.promise;
	clearTimeout(timeout);
}
