// Materializes the real agentic-reference benchmark app (Mealdrop,
// yannbf/mealdrop) into a sandbox, replacing the placeholder `vite-app`
// template for fixtures that opt in via a `evals.benchmarkApp` marker in
// their package.json (see readBenchmarkAppMarker). Used by
// evals/705-ar-mealdrop-example today; the 700-704 placeholders keep using
// `vite-app` until SB-1680/SB-1681 ship dedicated Base-UI branches.
//
// Mechanism: download the GitHub codeload tarball for the configured
// repo@ref and extract it INSIDE the sandbox with `curl | tar`, rather than
// pushing files through the Sandbox API. Two reasons:
// - the public `Sandbox.writeFiles` contract (types.ts) is
//   `Record<string, string>` — UTF-8 text only, no Buffer — so binary assets
//   (Mealdrop ships image files under src/assets) can't round-trip through it
//   without a manual base64 dance.
// - streaming thousands of small `writeFiles` calls through the sandbox RPC
//   is slower and more failure-prone than one `curl | tar` the sandbox runs
//   itself.
//
// `tar` only ever adds/overwrites the paths present in the archive — it
// never deletes anything already in the sandbox — and GitHub codeload
// tarballs never include `.git`. Mealdrop itself has no `__agent_eval__`
// directory, so a plain extraction at the sandbox root cannot clobber the
// harness scaffolding written by writeEvalSupportFiles (lib/templates.ts)
// before setup() runs. The one real collision is `.mcp.json` — Mealdrop
// ships its own (an inert `storybook-mcp` entry pointing at a Storybook this
// sandbox never starts) — which is why cases.ts materializes the benchmark
// app BEFORE writing any case-specific `.mcp.json` entries: the later
// merge-safe write (writeAgenticReferenceMcpConfig) reads whatever `tar`
// left behind and layers its own server on top instead of being overwritten
// by it.
import { isRecord } from '../shell-parse.ts';
import { AR_BENCHMARK_REF, AR_BENCHMARK_REPO } from './config.ts';

// The subset of the public Sandbox interface (from @vercel/agent-eval)
// this module needs, spelled out locally so lib/agentic-reference/*.test.ts
// files can implement a fake against a temp dir without importing the
// sandbox runtime.
export type MaterializeSandbox = {
	runCommand(
		command: string,
		args?: string[],
		options?: { env?: Record<string, string>; cwd?: string },
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	readFile(path: string): Promise<string>;
};

export type BenchmarkAppTarget = { repo: string; ref: string };
export type BenchmarkAppMarker = { repo?: string; ref?: string };

// GitHub owner/repo and git ref shapes, loose enough for real refs
// (branches with slashes, tags, 40-char SHAs) but tight enough to rule out
// shell metacharacters before the value is interpolated into a command
// string.
const SAFE_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const SAFE_REF_PATTERN = /^[\w./-]+$/;

/**
 * Reads the fixture's package.json out of the sandbox and returns its
 * `evals.benchmarkApp` marker, or undefined if the fixture doesn't opt in
 * (no marker, unparseable package.json, or no package.json yet).
 */
export async function readBenchmarkAppMarker(
	sandbox: MaterializeSandbox,
): Promise<BenchmarkAppMarker | undefined> {
	let raw: string;
	try {
		raw = await sandbox.readFile('package.json');
	} catch {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}

	if (!isRecord(parsed) || !isRecord(parsed.evals) || !isRecord(parsed.evals.benchmarkApp)) {
		return undefined;
	}

	const { repo, ref } = parsed.evals.benchmarkApp;
	return {
		repo: typeof repo === 'string' ? repo : undefined,
		ref: typeof ref === 'string' ? ref : undefined,
	};
}

/** Builds the codeload tarball URL for a repo@ref, rejecting unsafe input. */
export function buildBenchmarkAppTarballUrl(target: BenchmarkAppTarget): string {
	if (!SAFE_REPO_PATTERN.test(target.repo)) {
		throw new Error(`agentic-reference: unsafe benchmark app repo "${target.repo}"`);
	}
	if (!SAFE_REF_PATTERN.test(target.ref)) {
		throw new Error(`agentic-reference: unsafe benchmark app ref "${target.ref}"`);
	}
	return `https://codeload.github.com/${target.repo}/tar.gz/${target.ref}`;
}

/**
 * Pure builder for the in-sandbox materialization command — split out from
 * materializeBenchmarkApp so it can be unit-tested without a sandbox at all.
 * `--strip-components=1` drops the codeload tarball's top-level
 * `<repo>-<ref-with-slashes-dashed>/` directory so the app's files land
 * directly at the extraction root.
 */
export function buildMaterializeCommand(target: BenchmarkAppTarget): string {
	const url = buildBenchmarkAppTarballUrl(target);
	return [
		'set -euo pipefail',
		`curl -fsSL ${quoteForShell(url)} | tar xz --strip-components=1`,
	].join('\n');
}

function quoteForShell(value: string): string {
	return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

/**
 * Materializes AR_BENCHMARK_REPO@AR_BENCHMARK_REF (or an explicit
 * repo/ref override) into the sandbox's current working directory via
 * `curl | tar`. Resolution order when repo/ref aren't both given
 * explicitly: the fixture's `evals.benchmarkApp` package.json marker, then
 * the AR_BENCHMARK_REPO/AR_BENCHMARK_REF env-overridable config defaults.
 */
export async function materializeBenchmarkApp(
	sandbox: MaterializeSandbox,
	opts: { repo?: string; ref?: string } = {},
): Promise<void> {
	let { repo, ref } = opts;

	if (repo === undefined || ref === undefined) {
		const marker = await readBenchmarkAppMarker(sandbox);
		repo = repo ?? marker?.repo ?? AR_BENCHMARK_REPO;
		ref = ref ?? marker?.ref ?? AR_BENCHMARK_REF;
	}

	const command = buildMaterializeCommand({ repo, ref });
	const result = await sandbox.runCommand('bash', ['-lc', command]);
	if (result.exitCode !== 0) {
		throw new Error(
			`agentic-reference: failed to materialize benchmark app ${repo}@${ref} into the sandbox: ${
				result.stderr || result.stdout
			}`,
		);
	}
}
