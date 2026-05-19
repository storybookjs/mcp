import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { x } from 'tinyexec';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';

async function sendRequest(
	child: ChildProcess,
	stdoutData: string[],
	request: unknown,
	requestId: number,
	timeoutMs = 10_000,
) {
	child.stdin?.write(`${JSON.stringify(request)}\n`);

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`Timeout waiting for response to request ${requestId}`));
		}, timeoutMs);

		const checkResponse = () => {
			const allData = stdoutData.join('');
			if (allData.includes(`"id":${requestId}`)) {
				clearTimeout(timeout);
				resolve();
				return;
			}

			setTimeout(checkResponse, 50);
		};

		checkResponse();
	});

	const responseLine = stdoutData
		.join('')
		.split('\n')
		.filter((line) => line.trim())
		.find((line) => {
			try {
				return JSON.parse(line).id === requestId;
			} catch {
				return false;
			}
		});

	if (!responseLine) {
		throw new Error(`No response found for request ${requestId}`);
	}

	return JSON.parse(responseLine);
}

describe('Storybook MCP proxy placeholder', () => {
	let child: ChildProcess;
	let stdoutData: string[] = [];
	let stderrData: string[] = [];

	beforeAll(() => {
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const binPath = resolve(currentDir, './bin.ts');
		const proc = x('node', [binPath]);

		child = proc.process as ChildProcess;
		child.stdout?.on('data', (chunk) => stdoutData.push(chunk.toString()));
		child.stderr?.on('data', (chunk) => stderrData.push(chunk.toString()));
	});

	afterAll(() => {
		child.kill();
	});

	it('responds to initialize and lists no tools', async () => {
		const initializeResponse = await sendRequest(
			child,
			stdoutData,
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: {
						name: 'test-client',
						version: '1.0.0',
					},
				},
			},
			1,
		);

		expect(initializeResponse).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				serverInfo: {
					name: '@storybook/mcp-proxy',
				},
			},
		});

		const toolsResponse = await sendRequest(
			child,
			stdoutData,
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list',
				params: {},
			},
			2,
		);

		expect(toolsResponse).toMatchObject({
			jsonrpc: '2.0',
			id: 2,
			result: {
				tools: [],
			},
		});
		expect(stderrData).toEqual([]);
	});
});
