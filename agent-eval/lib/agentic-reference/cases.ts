// The 4 context cases the agentic-reference eval A/Bs against each other
// (SB-1724 kickoff). Each case is just a `setup(sandbox)` — everything else
// (agent, model, effort, evals, runs) lives in the per-case experiment file
// under agent-eval/experiments/ar-*.ts.
//
// Deliberately minimal: the fixtures already select the `vite-app` template
// via their own `package.json` (`evals.template: "vite-app"`), so
// `setupSandbox` from lib/templates.ts materializes it without pulling in
// any Storybook wiring — vite-app ships no Storybook packages, so the
// Storybook-pinning / MCP-package-injection branches inside setupSandbox are
// all no-ops for it. That makes setupSandbox itself the "minimal setup" the
// empty/docs/treatment cases need; no need to reimplement template copying.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sandbox } from '@vercel/agent-eval';

import { isRecord } from '../shell-parse.ts';
import { setupSandbox } from '../templates.ts';
import { AR_STORYBOOK_MCP_URL } from './config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OFFICIAL_DOCS_SOURCE_PATH = path.join(__dirname, 'docs', 'base-ui-official', 'README.md');
const OFFICIAL_DOCS_SANDBOX_PATH = path.posix.join('docs', 'base-ui', 'README.md');
const CLAUDE_MCP_CONFIG_PATH = '.mcp.json';
const AGENTIC_REFERENCE_MCP_SERVER_NAME = 'storybook-design-system-mcp';

export type AgenticReferenceCaseId =
	| 'control-empty'
	| 'control-official-docs'
	| 'control-community-mcp'
	| 'treatment-storybook-mcp';

export type AgenticReferenceCase = {
	id: AgenticReferenceCaseId;
	label: string;
	/** Linear issue that owns fleshing this case out further. */
	linear: string;
	setup: (sandbox: Sandbox) => Promise<void>;
};

// setupSandbox's `integration` field is Storybook-integration terminology
// ('mcp' config file vs 'plugin' skills) reused here only as harness
// metadata (it lands in the sandbox's __agent_eval__/agent.json and is
// unused by our own EVAL.ts assertions). We map it onto the closest AR
// meaning: 'mcp' for the one case that actually wires an MCP server into
// .mcp.json, 'plugin' (no MCP config) for the rest.
async function setupBareSandbox(sandbox: Sandbox): Promise<void> {
	await setupSandbox(sandbox, { agent: 'claude-code', integration: 'plugin' });
}

async function writeAgenticReferenceMcpConfig(sandbox: Sandbox, url: string): Promise<void> {
	// writeClaudeMcpConfig in lib/templates.ts hardcodes the Storybook dev
	// server URL, so it can't be reused for a URL that's env-overridable
	// (real runs will point this at the published design-system Storybook).
	// This mirrors its merge-safe .mcp.json format without editing that file.
	let existingConfig: Record<string, unknown> = {};
	try {
		const raw = await sandbox.readFile(CLAUDE_MCP_CONFIG_PATH);
		const parsed: unknown = JSON.parse(raw);
		if (isRecord(parsed)) {
			existingConfig = parsed;
		}
	} catch {
		// No .mcp.json yet — the vite-app template doesn't ship one.
	}

	const mcpServers = isRecord(existingConfig.mcpServers) ? existingConfig.mcpServers : {};

	await sandbox.writeFiles({
		[CLAUDE_MCP_CONFIG_PATH]: JSON.stringify(
			{
				...existingConfig,
				mcpServers: {
					...mcpServers,
					[AGENTIC_REFERENCE_MCP_SERVER_NAME]: { type: 'http', url },
				},
			},
			null,
			2,
		).concat('\n'),
	});
}

export const AGENTIC_REFERENCE_CASES: readonly AgenticReferenceCase[] = [
	{
		id: 'control-empty',
		label: 'No docs, no MCP — code only',
		linear: 'SB-1726',
		setup: async (sandbox) => {
			await setupBareSandbox(sandbox);
		},
	},
	{
		id: 'control-official-docs',
		label: 'Curated base-ui.com docs available, no MCP',
		linear: 'SB-1726',
		setup: async (sandbox) => {
			await setupBareSandbox(sandbox);
			await sandbox.writeFiles({
				[OFFICIAL_DOCS_SANDBOX_PATH]: await fs.readFile(OFFICIAL_DOCS_SOURCE_PATH, 'utf8'),
			});
		},
	},
	{
		id: 'control-community-mcp',
		label: 'A community Base UI MCP/skill (not yet identified)',
		linear: 'SB-1682',
		setup: async () => {
			throw new Error('agentic-reference: community Base UI MCP not yet identified (SB-1682)');
		},
	},
	{
		id: 'treatment-storybook-mcp',
		label: 'Storybook MCP of a Base UI design-system Storybook',
		linear: 'SB-1725',
		setup: async (sandbox) => {
			// TODO(SB-1725): point at the published base Storybook instance /
			// local server orchestration (SB-1685) once it exists — today this
			// just wires the URL, nothing serves it in the sandbox yet.
			await setupSandbox(sandbox, { agent: 'claude-code', integration: 'mcp' });
			await writeAgenticReferenceMcpConfig(sandbox, AR_STORYBOOK_MCP_URL);
		},
	},
];

export function getAgenticReferenceCase(id: AgenticReferenceCaseId): AgenticReferenceCase {
	const found = AGENTIC_REFERENCE_CASES.find(
		(agenticReferenceCase) => agenticReferenceCase.id === id,
	);
	if (found === undefined) {
		throw new Error(`Unknown agentic-reference case id: ${id}`);
	}
	return found;
}
