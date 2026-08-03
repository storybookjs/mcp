// Serve the design-system Storybook MCP inside the sandbox instead of pointing
// the agent at a shared hosted endpoint. The server comes from a pkg.pr.new
// preview package — the design-system repo's MCP server with that branch's
// Storybook manifests baked in, published by its storybook-mcp-preview
// workflow on every push to research/experiment/* (see
// storybook-tmp/base-ui/apps/mcp-server). Each run gets a private server, so
// parallel runs cannot contend on a remote endpoint; the only external
// dependency left is the one-time tarball download at setup.
//
// Registered under the same server name the stock templates use, so every
// #test-utils workflow helper applies unchanged.
import type { Sandbox } from '@vercel/agent-eval';

import { type EvalAgent, writeStorybookMcpConfig } from '../templates.ts';

/** A design-system MCP preview package published to pkg.pr.new, selected by branch. */
export interface StorybookMcpPackageSpec {
	/** GitHub repo the package publishes from, e.g. 'storybook-tmp/base-ui'. */
	repo: string;
	/** npm package name, e.g. '@storybook-tmp/baseui-mcp'. */
	packageName: string;
	/** Branch whose latest published commit to serve, e.g. 'experiment/empty'. */
	branch: string;
}

export interface ResolvedStorybookMcpPackage extends StorybookMcpPackageSpec {
	/** The commit the branch resolved to at setup. Pins every run of the experiment. */
	sha: string;
}

// Every field lands inside a `bash -lc` script (and the sha in a URL), so the
// patterns double as shell-safety guards, like SAFE_GITHUB_PATH in
// external-repo.ts.
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;
const BRANCH_PATTERN = /^[\w./-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * The sandbox-local port the design-system MCP serves on. Not 6006: the eval
 * fixtures' own Storybooks own that port, and the migration flows may boot one.
 */
export const LOCAL_STORYBOOK_MCP_PORT = 13316;

/** Typecheck and shell-safety-check a package spec, throwing with the reason. */
export function assertStorybookMcpPackageSpec(spec: StorybookMcpPackageSpec): void {
	if (!REPO_PATTERN.test(spec.repo)) {
		throw new Error(`storybookMcpPackage: repo must match ${String(REPO_PATTERN)}`);
	}
	if (!PACKAGE_NAME_PATTERN.test(spec.packageName)) {
		throw new Error(`storybookMcpPackage: packageName must match ${String(PACKAGE_NAME_PATTERN)}`);
	}
	if (!BRANCH_PATTERN.test(spec.branch)) {
		throw new Error(`storybookMcpPackage: branch must match ${String(BRANCH_PATTERN)}`);
	}
}

/**
 * pkg.pr.new long-form tarball URL for a resolved package. Sha-addressed on
 * purpose: branch refs are mutable (and slash-in-branch support is unproven),
 * while sha URLs are immutable and match the pin recorded for the analyzer.
 */
export function packageTarballUrl(spec: StorybookMcpPackageSpec, sha: string): string {
	return `https://pkg.pr.new/${spec.repo}/${spec.packageName}@${sha}`;
}

// One resolution per (repo, branch) for the process lifetime: all runs of an
// experiment pin the same commit even if the branch moves mid-experiment.
const resolutionCache = new Map<string, string>();

function resolutionKey(spec: StorybookMcpPackageSpec): string {
	return `${spec.repo}@${spec.branch}`;
}

/**
 * Resolve a spec's branch to its current head commit via the GitHub API,
 * host-side, before any sandbox time or agent tokens are spent.
 */
export async function resolveStorybookMcpPackage(
	spec: StorybookMcpPackageSpec,
): Promise<ResolvedStorybookMcpPackage> {
	assertStorybookMcpPackageSpec(spec);

	const cached = resolutionCache.get(resolutionKey(spec));
	if (cached !== undefined) {
		return { ...spec, sha: cached };
	}

	const url = `https://api.github.com/repos/${spec.repo}/commits/${encodeURIComponent(spec.branch)}`;
	const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const response = await fetch(url, {
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': 'storybook-agent-eval',
			...(token !== undefined && token !== '' ? { authorization: `Bearer ${token}` } : {}),
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`resolveStorybookMcpPackage: could not resolve ${spec.repo}@${spec.branch} ` +
				`(HTTP ${response.status} from the GitHub API). The branch must exist and its ` +
				`storybook-mcp-preview workflow must have published before this case can run.`,
		);
	}
	const body = (await response.json()) as { sha?: unknown };
	if (typeof body.sha !== 'string' || !SHA_PATTERN.test(body.sha)) {
		throw new Error(
			`resolveStorybookMcpPackage: unexpected commits API response for ${spec.repo}@${spec.branch}`,
		);
	}

	resolutionCache.set(resolutionKey(spec), body.sha);
	return { ...spec, sha: body.sha };
}

const DOWNLOAD_ATTEMPTS = 3;
const READY_TIMEOUT_SECONDS = 60;

const INITIALIZE_BODY = JSON.stringify({
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-03-26',
		capabilities: {},
		clientInfo: { name: 'agent-eval-local-mcp', version: '0' },
	},
});

/**
 * The bash script that materializes and boots the server in the sandbox. All
 * interpolated values are pre-validated shell-safe (assertStorybookMcpPackageSpec
 * plus SHA_PATTERN via packageTarballUrl's inputs).
 *
 * Everything lives under ~/.storybook-mcp, outside the workspace: the agent must
 * not find harness plumbing (tarball, server bundle, logs) in the project it is
 * evaluated on, and run snapshots must not pick it up. That also means server
 * logs only surface when this script fails, on stderr.
 */
export function buildLocalMcpSetupScript(tarballUrl: string, port: number): string {
	return [
		'set -euo pipefail',
		'dir="$HOME/.storybook-mcp"',
		'mkdir -p "$dir"',
		`for attempt in $(seq 1 ${DOWNLOAD_ATTEMPTS}); do`,
		`	if curl -fsSL --connect-timeout 30 --max-time 300 -o "$dir/package.tgz" '${tarballUrl}'; then`,
		'		break',
		'	fi',
		`	if [ "$attempt" -eq ${DOWNLOAD_ATTEMPTS} ]; then`,
		`		echo 'Failed to download ${tarballUrl} after ${DOWNLOAD_ATTEMPTS} attempts' >&2`,
		'		exit 1',
		'	fi',
		'	sleep $((attempt * 10))',
		'done',
		'tar xzf "$dir/package.tgz" -C "$dir"',
		// The tarball's top-level directory is package/ (npm pack layout); the
		// bundle is self-contained, so no install step.
		`nohup node "$dir/package/dist/cli.js" --port ${port} > "$dir/server.log" 2>&1 &`,
		'disown',
		`for _ in $(seq 1 ${READY_TIMEOUT_SECONDS}); do`,
		`	if curl -fsS -o /dev/null -X POST "http://127.0.0.1:${port}/mcp" \\`,
		"		-H 'Content-Type: application/json' \\",
		"		-H 'Accept: application/json, text/event-stream' \\",
		`		--data '${INITIALIZE_BODY}'; then`,
		'		exit 0',
		'	fi',
		'	sleep 1',
		'done',
		`echo 'Storybook MCP server not ready on port ${port} after ${READY_TIMEOUT_SECONDS}s; log tail:' >&2`,
		'tail -n 50 "$dir/server.log" >&2',
		'exit 1',
	].join('\n');
}

/**
 * Materialize the resolved package in the sandbox, boot its server, wait until
 * it answers an MCP initialize request, and register it in whichever config
 * format the agent reads. Call in an experiment's setup(), any time after
 * setupSandbox(). Fails the run before any agent tokens are spent if the
 * download or boot fails.
 */
export async function setupLocalStorybookMcp(
	sandbox: Sandbox,
	resolved: ResolvedStorybookMcpPackage,
	agent: EvalAgent,
): Promise<void> {
	assertStorybookMcpPackageSpec(resolved);
	if (!SHA_PATTERN.test(resolved.sha)) {
		throw new Error('setupLocalStorybookMcp: resolved sha must be a 40-char lowercase hex sha');
	}

	const tarballUrl = packageTarballUrl(resolved, resolved.sha);
	const script = buildLocalMcpSetupScript(tarballUrl, LOCAL_STORYBOOK_MCP_PORT);
	const result = await sandbox.runCommand('bash', ['-lc', script]);
	if (result.exitCode !== 0) {
		const tail = (result.stderr || result.stdout).trim().split('\n').slice(-20).join('\n');
		throw new Error(
			`setupLocalStorybookMcp: failed to serve ${resolved.packageName}@${resolved.sha} ` +
				`(${resolved.branch}) in the sandbox:\n${tail}`,
		);
	}

	await writeStorybookMcpConfig(sandbox, agent, `http://127.0.0.1:${LOCAL_STORYBOOK_MCP_PORT}/mcp`);
}
