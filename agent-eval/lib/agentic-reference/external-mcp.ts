// Point the sandbox's agent at an externally hosted Storybook MCP — e.g. a
// published Chromatic build, which serves `@storybook/mcp` at `<build-url>/mcp`.
// Nothing boots in the sandbox; pin a build URL per experiment for reproducible
// runs (Chromatic build URLs are immutable).
//
// Registered under the same server name the stock templates use, so every
// #test-utils workflow helper applies unchanged. Writes Claude Code's `.mcp.json`
// or Codex's `.codex/config.toml`, depending on the agent.
import type { Sandbox } from '@vercel/agent-eval';

import { isRecord } from '../shell-parse.ts';

// These merges duplicate templates.ts's private writeClaudeMcpServer /
// appendCodexConfig: exporting those would violate the SB-1724 additive-only
// constraint. If it lifts, export the canonical helpers and delete these.
const CLAUDE_MCP_CONFIG_PATH = '.mcp.json';
const CODEX_CONFIG_PATH = '.codex/config.toml';
const STORYBOOK_MCP_SERVER_NAME = 'storybook-dev-mcp';
// Match the version the rest of the harness negotiates (lib/mcp/*), so a server
// that enforces protocol negotiation cannot fail the probe while answering the
// real agent fine.
const MCP_PROTOCOL_VERSION = '2025-06-18';

type EvalAgent = 'claude-code' | 'codex';

/** Accept a Storybook build URL with or without the /mcp suffix. */
function normalizeMcpUrl(storybookUrl: string): string {
	const trimmed = storybookUrl.replace(/\/+$/, '');
	return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

/**
 * Fail fast (host-side, before any agent tokens are spent) if the endpoint
 * does not answer an MCP initialize request.
 */
async function probeMcpEndpoint(url: string): Promise<void> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: 'agent-eval-probe', version: '0' },
				},
			}),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (error) {
		throw new Error(`registerExternalStorybookMcp: ${url} is unreachable: ${String(error)}`);
	}
	if (!response.ok) {
		throw new Error(
			`registerExternalStorybookMcp: ${url} answered HTTP ${response.status} to an MCP initialize request`,
		);
	}
}

async function registerForClaude(sandbox: Sandbox, url: string): Promise<void> {
	const existing: unknown = JSON.parse(
		await sandbox.readFile(CLAUDE_MCP_CONFIG_PATH).catch(() => '{}'),
	);
	const config = isRecord(existing) ? existing : {};
	const mcpServers = isRecord(config.mcpServers) ? config.mcpServers : {};

	await sandbox.writeFiles({
		[CLAUDE_MCP_CONFIG_PATH]: JSON.stringify(
			{
				...config,
				mcpServers: { ...mcpServers, [STORYBOOK_MCP_SERVER_NAME]: { type: 'http', url } },
			},
			null,
			2,
		).concat('\n'),
	});
}

// Drop a whole TOML table (its header plus every line up to the next `[`) from a
// config. Enough for the flat sections this file and templates.ts write.
function dropTomlSection(config: string, header: string): string {
	const kept: string[] = [];
	let inSection = false;
	for (const line of config.split('\n')) {
		if (line.trim() === header) {
			inSection = true;
			continue;
		}
		if (inSection && line.trimStart().startsWith('[')) {
			inSection = false;
		}
		if (!inSection) {
			kept.push(line);
		}
	}
	return kept.join('\n');
}

async function registerForCodex(sandbox: Sandbox, url: string): Promise<void> {
	const header = `[mcp_servers.${STORYBOOK_MCP_SERVER_NAME}]`;
	const section = `${header}
url = "${url}"
default_tools_approval_mode = "auto"
startup_timeout_sec = 30
tool_timeout_sec = 120
`;
	// Replace rather than skip: a section left by a template or an earlier setup
	// step points at a different URL, and silently keeping it would run the
	// experiment against the wrong Storybook.
	const existing = await sandbox.readFile(CODEX_CONFIG_PATH).catch(() => '');
	const rest = dropTomlSection(existing, header).trimEnd();
	await sandbox.writeFiles({
		[CODEX_CONFIG_PATH]: rest.length > 0 ? `${rest}\n\n${section}` : section,
	});
}

/**
 * Register an externally hosted Storybook MCP in the sandbox, in whichever
 * config format the agent reads. Call in an experiment's setup(), any time
 * after setupSandbox().
 */
export async function registerExternalStorybookMcp(
	sandbox: Sandbox,
	storybookUrl: string,
	agent: EvalAgent,
): Promise<void> {
	const url = normalizeMcpUrl(storybookUrl);
	await probeMcpEndpoint(url);
	if (agent === 'codex') {
		await registerForCodex(sandbox, url);
	} else {
		await registerForClaude(sandbox, url);
	}
}
