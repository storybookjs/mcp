#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { DEFAULT_REGISTRY_DIR } from '../src/registry.ts';
import type { McpStatusV1, StorybookInstanceRecordV1 } from '../src/types/index.ts';

const DEFAULT_PORT = 6006;
const DEFAULT_HOST = 'localhost';

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

type PackageJson = {
	packageManager?: string;
	version?: string;
};

type CliArgs = {
	projectPath: string;
	port: number;
	host: string;
	registryDir: string;
	storybookArgs: string[];
};

function printUsage(): void {
	console.log(`Usage: node scripts/run-storybook.ts <storybook-project-path> [options] [-- <storybook args>]

Options:
  --port, -p <port>          Port to pass to "storybook dev" (default: ${DEFAULT_PORT})
  --host <host>              Host to use in the registry URL (default: ${DEFAULT_HOST})
  --registryDir <path>       Storybook instance registry directory (default: ${DEFAULT_REGISTRY_DIR})
  --help, -h                 Show this help message
`);
}

function parseCliArgs(argv: string[]): CliArgs {
	let projectPath: string | undefined;
	let port = DEFAULT_PORT;
	let host = DEFAULT_HOST;
	let registryDir = DEFAULT_REGISTRY_DIR;
	const storybookArgs: string[] = [];
	let passthrough = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]!;

		if (passthrough) {
			storybookArgs.push(arg);
			continue;
		}

		if (arg === '--') {
			passthrough = true;
			continue;
		}

		if (arg === '--help' || arg === '-h') {
			printUsage();
			process.exit(0);
		}

		if (arg === '--port' || arg === '-p') {
			const value = argv[++index];
			if (!value) throw new Error(`${arg} requires a value`);
			port = parsePort(value);
			continue;
		}

		if (arg.startsWith('--port=')) {
			port = parsePort(arg.slice('--port='.length));
			continue;
		}

		if (arg === '--host') {
			const value = argv[++index];
			if (!value) throw new Error('--host requires a value');
			host = value;
			continue;
		}

		if (arg.startsWith('--host=')) {
			host = arg.slice('--host='.length);
			continue;
		}

		if (arg === '--registryDir' || arg === '--registry-dir') {
			const value = argv[++index];
			if (!value) throw new Error(`${arg} requires a value`);
			registryDir = path.resolve(value);
			continue;
		}

		if (arg.startsWith('--registryDir=')) {
			registryDir = path.resolve(arg.slice('--registryDir='.length));
			continue;
		}

		if (arg.startsWith('--registry-dir=')) {
			registryDir = path.resolve(arg.slice('--registry-dir='.length));
			continue;
		}

		if (!projectPath) {
			projectPath = arg;
			continue;
		}

		storybookArgs.push(arg);
	}

	if (!projectPath) {
		throw new Error('Missing required <storybook-project-path> argument');
	}

	return {
		projectPath: path.resolve(projectPath),
		port,
		host,
		registryDir,
		storybookArgs,
	};
}

function parsePort(value: string): number {
	const port = Number.parseInt(value, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid port: ${value}`);
	}
	return port;
}

async function readPackageJson(packageJsonPath: string): Promise<PackageJson | undefined> {
	try {
		return JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as PackageJson;
	} catch {
		return undefined;
	}
}

async function getStorybookVersion(projectPath: string): Promise<string | undefined> {
	try {
		const requireFromProject = createRequire(path.join(projectPath, 'package.json'));
		const storybookPackagePath = requireFromProject.resolve('storybook/package.json');
		return (await readPackageJson(storybookPackagePath))?.version;
	} catch {
		return undefined;
	}
}

async function detectPackageManager(projectPath: string): Promise<PackageManager> {
	const packageJson = await readPackageJson(path.join(projectPath, 'package.json'));
	const declaredPackageManager = packageJson?.packageManager?.split('@')[0];

	if (isSupportedPackageManager(declaredPackageManager)) {
		return declaredPackageManager;
	}

	if (existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
	if (
		existsSync(path.join(projectPath, 'bun.lockb')) ||
		existsSync(path.join(projectPath, 'bun.lock'))
	) {
		return 'bun';
	}
	if (existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
	if (existsSync(path.join(projectPath, 'package-lock.json'))) return 'npm';

	return 'pnpm';
}

function isSupportedPackageManager(value: string | undefined): value is PackageManager {
	return value === 'pnpm' || value === 'npm' || value === 'yarn' || value === 'bun';
}

function shouldWriteInstanceRecord(storybookVersion: string | undefined): boolean {
	if (!storybookVersion) return false;

	const match = /^(\d+)\.(\d+)/.exec(storybookVersion);
	if (!match) return false;

	const major = Number.parseInt(match[1]!, 10);
	const minor = Number.parseInt(match[2]!, 10);

	return major < 10 || (major === 10 && minor <= 4);
}

function hasAddonMcp(projectPath: string): boolean {
	try {
		const requireFromProject = createRequire(path.join(projectPath, 'package.json'));
		requireFromProject.resolve('@storybook/addon-mcp/package.json');
		return true;
	} catch {
		return false;
	}
}

async function writeRecord(recordPath: string, record: StorybookInstanceRecordV1): Promise<void> {
	await fs.mkdir(path.dirname(recordPath), { recursive: true });
	await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
}

function getInitialMcpStatusV1(projectPath: string): McpStatusV1 {
	return hasAddonMcp(projectPath) ? 'starting' : 'not-installed';
}

function createRecord(args: {
	childPid: number;
	instanceId: string;
	projectPath: string;
	port: number;
	host: string;
	storybookVersion: string;
	mcpStatus: McpStatusV1;
}): StorybookInstanceRecordV1 {
	const now = new Date().toISOString();
	const url = `http://${args.host}:${args.port}`;
	const record: StorybookInstanceRecordV1 = {
		schemaVersion: 1,
		instanceId: args.instanceId,
		pid: args.childPid,
		cwd: args.projectPath,
		url,
		port: args.port,
		storybookVersion: args.storybookVersion,
		startedAt: now,
		updatedAt: now,
		mcp: {
			status: args.mcpStatus,
		},
	};

	if (args.mcpStatus === 'ready') {
		record.mcp.endpoint = `${url}/mcp`;
	}

	return record;
}

function buildStorybookCommand(
	packageManager: PackageManager,
	port: number,
	storybookArgs: string[],
): { command: string; args: string[] } {
	const args = ['dev', '--port', port.toString(), '--no-open', ...storybookArgs];

	switch (packageManager) {
		case 'pnpm':
			return { command: 'pnpm', args: ['exec', 'storybook', ...args] };
		case 'npm':
			return { command: 'npm', args: ['exec', 'storybook', '--', ...args] };
		case 'yarn':
			return { command: 'yarn', args: ['storybook', ...args] };
		case 'bun':
			return { command: 'bunx', args: ['storybook', ...args] };
	}
}

async function main(): Promise<void> {
	const args = parseCliArgs(process.argv.slice(2));

	const packageJsonPath = path.join(args.projectPath, 'package.json');
	if (!existsSync(packageJsonPath)) {
		throw new Error(`No package.json found at ${packageJsonPath}`);
	}

	const storybookVersion = await getStorybookVersion(args.projectPath);
	const shouldWriteRecord = shouldWriteInstanceRecord(storybookVersion);
	const storybookCommand = buildStorybookCommand(
		await detectPackageManager(args.projectPath),
		args.port,
		args.storybookArgs,
	);
	const child = spawn(storybookCommand.command, storybookCommand.args, {
		cwd: args.projectPath,
		env: process.env,
		stdio: ['inherit', 'pipe', 'pipe'],
	});

	let recordPath: string | undefined;
	let record: StorybookInstanceRecordV1 | undefined;
	let recordReady = false;
	let cleaningUp = false;

	const cleanupRecord = async () => {
		if (!recordPath || cleaningUp) return;
		cleaningUp = true;
		try {
			await fs.rm(recordPath, { force: true });
		} finally {
			cleaningUp = false;
		}
	};

	const cleanupRecordSync = () => {
		if (!recordPath) return;
		rmSync(recordPath, { force: true });
	};

	child.once('error', (error) => {
		cleanupRecord().finally(() => {
			console.error(`Failed to start Storybook: ${error.message}`);
			process.exitCode = 1;
		});
	});

	if (!child.pid) {
		throw new Error('Failed to start Storybook process');
	}

	if (shouldWriteRecord && storybookVersion) {
		const instanceId = randomUUID();
		recordPath = path.join(args.registryDir, `${instanceId}.json`);
		record = createRecord({
			childPid: child.pid,
			instanceId,
			projectPath: args.projectPath,
			port: args.port,
			host: args.host,
			storybookVersion,
			mcpStatus: getInitialMcpStatusV1(args.projectPath),
		});
		try {
			await writeRecord(recordPath, record);
		} catch (error) {
			child.kill();
			throw error;
		}
		console.error(`Wrote Storybook instance record: ${recordPath}`);
	} else if (!storybookVersion) {
		console.error('Could not determine installed Storybook version; skipping instance record.');
	}

	const markReady = () => {
		if (!record || !recordPath || recordReady || record.mcp.status !== 'starting') return;

		recordReady = true;
		record = {
			...record,
			updatedAt: new Date().toISOString(),
			mcp: {
				status: 'ready',
				endpoint: `${record.url}/mcp`,
			},
		};
		writeRecord(recordPath, record).catch((error) => {
			console.error(`Failed to update Storybook instance record: ${(error as Error).message}`);
		});
	};

	const pipeOutput = (stream: NodeJS.ReadableStream | null, target: NodeJS.WriteStream) => {
		stream?.on('data', (chunk: Buffer) => {
			target.write(chunk);
			if (chunk.toString().includes('Storybook ready!')) {
				markReady();
			}
		});
	};

	pipeOutput(child.stdout, process.stdout);
	pipeOutput(child.stderr, process.stderr);

	const shutdown = (signal: NodeJS.Signals) => {
		child.kill(signal);
		cleanupRecord().finally(() => {
			setTimeout(() => process.exit(1), 5_000).unref();
		});
	};

	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
	process.once('SIGHUP', shutdown);
	process.once('exit', cleanupRecordSync);

	child.on('exit', (code, signal) => {
		cleanupRecord().finally(() => {
			if (signal) process.exitCode = 1;
			else process.exitCode = code ?? 1;
		});
	});
}

await main().catch((error) => {
	console.error((error as Error).message);
	process.exit(1);
});
