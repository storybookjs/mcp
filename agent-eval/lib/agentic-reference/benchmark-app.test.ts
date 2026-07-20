import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
	buildBenchmarkAppTarballUrl,
	buildMaterializeCommand,
	materializeBenchmarkApp,
	readBenchmarkAppMarker,
	type MaterializeSandbox,
} from './benchmark-app.ts';

const execFileAsync = promisify(execFile);

// Real network test: hits the pinned Mealdrop benchmark branch (SB-1724/705)
// on GitHub, so it's slower than a typical unit test. No mocking — the point
// of this eval is proving the real materialization pipeline works end to
// end, so a mocked-out network call would test nothing.
const NETWORK_TEST_TIMEOUT_MS = 60_000;
const PINNED_TARGET = { repo: 'yannbf/mealdrop', ref: 'agentic-reference/original' };

// Minimal fake Sandbox backed by a real temp directory: `runCommand('bash',
// ['-lc', script])` really spawns bash with cwd = the temp dir, so
// `curl | tar` in materializeBenchmarkApp genuinely downloads, extracts, and
// writes files to disk — the same shape of operation the real
// SandboxManager.runCommand does inside a Vercel/Docker sandbox (see
// dist/lib/sandbox.js: runCommand shells out with cwd defaulting to the
// sandbox's working directory).
class FakeTempDirSandbox implements MaterializeSandbox {
	constructor(private readonly dir: string) {}

	async runCommand(
		command: string,
		args: string[] = [],
		options?: { env?: Record<string, string>; cwd?: string },
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		try {
			const { stdout, stderr } = await execFileAsync(command, args, {
				cwd: options?.cwd ?? this.dir,
				env: { ...process.env, ...options?.env },
				maxBuffer: 1024 * 1024 * 64,
			});
			return { stdout, stderr, exitCode: 0 };
		} catch (error) {
			const execError = error as { stdout?: string; stderr?: string; code?: number };
			return {
				stdout: execError.stdout ?? '',
				stderr: execError.stderr ?? String(error),
				exitCode: typeof execError.code === 'number' ? execError.code : 1,
			};
		}
	}

	async readFile(path: string): Promise<string> {
		return readFileSync(join(this.dir, path), 'utf8');
	}
}

describe('buildBenchmarkAppTarballUrl', () => {
	it('builds a codeload tarball URL for a repo@ref', () => {
		expect(buildBenchmarkAppTarballUrl(PINNED_TARGET)).toBe(
			'https://codeload.github.com/yannbf/mealdrop/tar.gz/agentic-reference/original',
		);
	});

	it('rejects a repo containing shell metacharacters', () => {
		expect(() =>
			buildBenchmarkAppTarballUrl({ repo: 'yannbf/mealdrop; rm -rf /', ref: 'main' }),
		).toThrow(/unsafe benchmark app repo/);
	});

	it('rejects a ref containing shell metacharacters', () => {
		expect(() =>
			buildBenchmarkAppTarballUrl({ repo: 'yannbf/mealdrop', ref: '$(rm -rf /)' }),
		).toThrow(/unsafe benchmark app ref/);
	});
});

describe('buildMaterializeCommand', () => {
	it('is a pure function: builds a curl | tar command string without touching a sandbox', () => {
		const command = buildMaterializeCommand(PINNED_TARGET);

		expect(command).toContain('set -euo pipefail');
		expect(command).toContain(
			"curl -fsSL 'https://codeload.github.com/yannbf/mealdrop/tar.gz/agentic-reference/original'",
		);
		expect(command).toContain('tar xz --strip-components=1');
	});

	it('builds a different command for a different repo/ref pair', () => {
		const command = buildMaterializeCommand({
			repo: 'yannbf/mealdrop',
			ref: 'agentic-reference/baseline',
		});

		expect(command).toContain(
			"curl -fsSL 'https://codeload.github.com/yannbf/mealdrop/tar.gz/agentic-reference/baseline'",
		);
	});
});

describe('readBenchmarkAppMarker', () => {
	function fakeSandboxWithPackageJson(packageJson: unknown): MaterializeSandbox {
		const dir = mkdtempSync(join(tmpdir(), 'ar-benchmark-app-marker-'));
		writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson));
		return new FakeTempDirSandbox(dir);
	}

	it('returns the evals.benchmarkApp marker when present', async () => {
		const sandbox = fakeSandboxWithPackageJson({
			name: '705-ar-mealdrop-example',
			evals: { benchmarkApp: { repo: 'yannbf/mealdrop', ref: 'agentic-reference/original' } },
		});

		await expect(readBenchmarkAppMarker(sandbox)).resolves.toEqual({
			repo: 'yannbf/mealdrop',
			ref: 'agentic-reference/original',
		});
	});

	it('returns undefined when the fixture has no benchmarkApp marker', async () => {
		const sandbox = fakeSandboxWithPackageJson({
			name: '700-ar-create-ui',
			evals: { template: 'vite-app' },
		});

		await expect(readBenchmarkAppMarker(sandbox)).resolves.toBeUndefined();
	});

	it('returns undefined when package.json does not exist yet', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ar-benchmark-app-marker-missing-'));
		await expect(readBenchmarkAppMarker(new FakeTempDirSandbox(dir))).resolves.toBeUndefined();
	});
});

describe('materializeBenchmarkApp', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true });
			dir = undefined;
		}
	});

	it(
		'downloads and extracts the real pinned Mealdrop branch into the sandbox',
		async () => {
			dir = mkdtempSync(join(tmpdir(), 'ar-benchmark-app-materialize-'));

			// Harness scaffolding that would already be in the sandbox before
			// setup() runs (writeEvalSupportFiles in lib/templates.ts) — the
			// sentinel this test protects against materialization clobbering.
			const sentinelDir = join(dir, '__agent_eval__');
			mkdirSync(sentinelDir, { recursive: true });
			const sentinelPath = join(sentinelDir, 'agent.json');
			writeFileSync(sentinelPath, JSON.stringify({ agent: 'claude-code', integration: 'plugin' }));

			const sandbox = new FakeTempDirSandbox(dir);
			await materializeBenchmarkApp(sandbox, PINNED_TARGET);

			const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				name?: string;
			};
			expect(packageJson.name).toBe('course-app');
			expect(existsSync(join(dir, 'src', 'components', 'RestaurantCard'))).toBe(true);
			expect(existsSync(join(dir, 'src', 'components', 'Badge'))).toBe(true);

			// The tarball has no __agent_eval__ directory, so extraction must not
			// have touched the pre-existing sentinel file.
			expect(existsSync(sentinelPath)).toBe(true);
			expect(JSON.parse(readFileSync(sentinelPath, 'utf8'))).toEqual({
				agent: 'claude-code',
				integration: 'plugin',
			});
		},
		NETWORK_TEST_TIMEOUT_MS,
	);

	it(
		'resolves repo/ref from the package.json marker when no explicit opts are given',
		async () => {
			dir = mkdtempSync(join(tmpdir(), 'ar-benchmark-app-materialize-marker-'));
			writeFileSync(
				join(dir, 'package.json'),
				JSON.stringify({ name: '705-ar-mealdrop-example', evals: { benchmarkApp: PINNED_TARGET } }),
			);

			const sandbox = new FakeTempDirSandbox(dir);
			await materializeBenchmarkApp(sandbox);

			const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				name?: string;
			};
			expect(packageJson.name).toBe('course-app');
		},
		NETWORK_TEST_TIMEOUT_MS,
	);

	it(
		'throws with the repo@ref in the message when the download fails',
		async () => {
			dir = mkdtempSync(join(tmpdir(), 'ar-benchmark-app-materialize-failure-'));
			const sandbox = new FakeTempDirSandbox(dir);

			await expect(
				materializeBenchmarkApp(sandbox, { repo: 'yannbf/does-not-exist-xyz', ref: 'main' }),
			).rejects.toThrow(/yannbf\/does-not-exist-xyz@main/);
		},
		NETWORK_TEST_TIMEOUT_MS,
	);
});
