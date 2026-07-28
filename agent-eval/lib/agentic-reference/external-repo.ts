// Materialize an arbitrary GitHub repo into the sandbox for agentic-reference
// evals. Which repo is declared by the fixture's own package.json:
//
//   "evals": { "externalRepo": { "repo": "owner/name", "ref": "<sha>" } }
import { readFileSync } from 'node:fs';

import type { Sandbox } from '@vercel/agent-eval';

import { isRecord } from '../shell-parse.ts';

/** Keep interpolated values shell-safe (they land in a bash command). */
const SAFE_GITHUB_PATH = /^[\w./-]+$/;

export interface ExternalRepoPin {
	repo: string;
	ref: string;
}

/** Parse (and shell-sanity-check) a fixture's `evals.externalRepo` marker. */
export function parseExternalRepoMarker(packageJsonContent: string): ExternalRepoPin {
	const manifest: unknown = JSON.parse(packageJsonContent);
	const evals = isRecord(manifest) ? manifest.evals : undefined;
	const marker = isRecord(evals) ? evals.externalRepo : undefined;

	if (!isRecord(marker)) {
		throw new Error(
			'externalRepo: fixture package.json has no `evals.externalRepo` marker; ' +
				'expected { "evals": { "externalRepo": { "repo": "owner/name", "ref": "<sha>" } } }',
		);
	}

	const { repo, ref } = marker;
	if (typeof repo !== 'string' || !SAFE_GITHUB_PATH.test(repo)) {
		throw new Error(`externalRepo: evals.externalRepo.repo must match ${String(SAFE_GITHUB_PATH)}`);
	}
	if (typeof ref !== 'string' || !SAFE_GITHUB_PATH.test(ref)) {
		throw new Error(`externalRepo: evals.externalRepo.ref must match ${String(SAFE_GITHUB_PATH)}`);
	}
	return { repo, ref };
}

// Pin the sandbox @vercel/agent-eval to this package's own version — EVAL.ts
// (via #test-utils) calls its loadTranscript at validation time.
function harnessVersion(): string {
	const rootManifest: unknown = JSON.parse(
		readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
	);
	const devDependencies = isRecord(rootManifest) ? rootManifest.devDependencies : undefined;
	const version = isRecord(devDependencies) ? devDependencies['@vercel/agent-eval'] : undefined;
	if (typeof version !== 'string') {
		throw new Error('setupExternalRepo: @vercel/agent-eval missing from agent-eval/package.json');
	}
	return version;
}

function exists(sandbox: Sandbox, path: string): Promise<boolean> {
	return sandbox.readFile(path).then(
		() => true,
		() => false,
	);
}

async function runOrThrow(
	sandbox: Sandbox,
	command: string,
	args: string[],
	label: string,
): Promise<void> {
	const result = await sandbox.runCommand(command, args);
	if (result.exitCode !== 0) {
		const tail = (result.stderr || result.stdout).trim().split('\n').slice(-15).join('\n');
		throw new Error(`setupExternalRepo: ${label} failed:\n${tail}`);
	}
}

// Install with whichever package manager the repo actually uses. npm-based
// repos need nothing — the harness runs its own `npm install` after setup. Only
// the vendored-Yarn branch has run against a real app.
async function installDependencies(sandbox: Sandbox): Promise<void> {
	const yarnrc = await sandbox.readFile('.yarnrc.yml').catch(() => '');
	const vendoredYarn = /^\s*yarnPath:\s*(\S+)/m.exec(yarnrc)?.[1];
	if (vendoredYarn !== undefined && (await exists(sandbox, vendoredYarn))) {
		await runOrThrow(sandbox, 'node', [vendoredYarn, 'install'], 'vendored yarn install');
		return;
	}

	const usesPnpm = await exists(sandbox, 'pnpm-lock.yaml');
	const usesYarn = await exists(sandbox, 'yarn.lock');
	if (!usesPnpm && !usesYarn) {
		return;
	}

	if ((await sandbox.runCommand('corepack', ['enable'])).exitCode !== 0) {
		await runOrThrow(sandbox, 'npm', ['install', '-g', 'corepack'], 'install corepack');
	}
	await runOrThrow(
		sandbox,
		usesPnpm ? 'pnpm' : 'yarn',
		usesPnpm ? ['install', '--frozen-lockfile'] : ['install'],
		`${usesPnpm ? 'pnpm' : 'yarn'} install`,
	);
}

// Extract the repo over the sandbox root, install its deps, then restore the
// harness/template contract the tarball clobbers: the #test-utils import, the
// agent-eval devDependency, legacy-peer-deps, and a copy of vitest.config.ts
// under a name the harness won't overwrite at validation time.
//
// Ordering note: the manifest mutation deliberately lands *after*
// installDependencies(). The native install exists to reproduce the app's own
// lockfile-pinned tree (`pnpm install --frozen-lockfile` / vendored yarn), which
// a package.json carrying a dependency the lockfile has never seen would reject.
// The added @vercel/agent-eval devDependency is installed by the `npm install`
// every agent definition runs against the sandbox root right after setup().
export async function setupExternalRepo(sandbox: Sandbox): Promise<void> {
	const { repo, ref } = parseExternalRepoMarker(await sandbox.readFile('package.json'));
	const tarballUrl = `https://codeload.github.com/${repo}/tar.gz/${ref}`;

	// --strip-components=1 drops the tarball's top-level <name>-<ref>/ dir.
	const extract = await sandbox.runCommand('bash', [
		'-lc',
		`set -euo pipefail; curl -fsSL '${tarballUrl}' | tar xz --strip-components=1`,
	]);
	if (extract.exitCode !== 0) {
		const tail = (extract.stderr || extract.stdout).trim().split('\n').slice(-15).join('\n');
		throw new Error(`setupExternalRepo: failed to materialize ${repo}@${ref}:\n${tail}`);
	}

	await installDependencies(sandbox);

	const appVitestConfig = await sandbox.readFile('vitest.config.ts').catch(() => null);

	const appManifest: unknown = JSON.parse(await sandbox.readFile('package.json'));
	if (!isRecord(appManifest)) {
		throw new Error(`setupExternalRepo: ${repo}@${ref} package.json is not a JSON object`);
	}
	appManifest.imports = {
		...(isRecord(appManifest.imports) ? appManifest.imports : {}),
		'#test-utils': './__agent_eval__/test-utils.ts',
	};
	appManifest.devDependencies = {
		...(isRecord(appManifest.devDependencies) ? appManifest.devDependencies : {}),
		'@vercel/agent-eval': harnessVersion(),
	};

	const existingNpmrc = await sandbox.readFile('.npmrc').catch(() => '');
	const npmrc = [existingNpmrc.trim(), 'legacy-peer-deps=true'].filter(Boolean).join('\n') + '\n';

	await sandbox.writeFiles({
		'package.json': JSON.stringify(appManifest, null, '\t') + '\n',
		'.npmrc': npmrc,
		...(appVitestConfig !== null ? { 'vitest.config.app.ts': appVitestConfig } : {}),
	});
}
