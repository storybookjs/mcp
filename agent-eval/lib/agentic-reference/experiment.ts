// Shared experiment shape for agentic-reference evals. A case's agent support
// is whatever its options declare: the design-system Storybook MCP
// (`storybookMcpUrl`), other MCP servers (`mcpServers`), skills (`skillDirs`),
// extra sandbox files (`extraFiles`) — or nothing at all, the bare control.
// Gated behind EVAL_AGENTIC_REFERENCE=1 so the default matrix never spends
// on it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
	ExperimentConfig,
	RunCompleteContext,
	RunCompleteHook,
	Sandbox,
} from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../experiment.ts';
import {
	type EvalAgent,
	type EvalIntegration,
	type McpServerSpec,
	installSkillDir,
	registerMcpServer,
	setupSandbox,
} from '../templates.ts';
import {
	type ExternalRepoPin,
	parseExternalRepoFromManifest,
	setupExternalRepo,
} from './external-repo.ts';
import { registerExternalStorybookMcp } from './external-mcp.ts';
import { postAnalysis } from './post-analysis.ts';

import type { PostAnalysisExperiment } from '../post-analysis/types.ts';

interface AgenticRefExperimentOptions {
	/** Case name; recorded in `result.analysis.case` for the offline analyzer. */
	name: string;
	evals: string[];
	/** Coding agent to evaluate. Default 'claude-code'. */
	agent?: EvalAgent;
	/** Present = run with the design-system Storybook MCP registered at this URL. */
	storybookMcpUrl?: string;
	/**
	 * Sandbox flavor recorded in the agent context: Storybook tooling only.
	 * Defaults to 'mcp' with a storybookMcpUrl, bare ('none') without —
	 * mcpServers and skillDirs deliberately do not affect it, since they carry
	 * non-Storybook support.
	 */
	integration?: EvalIntegration;
	/** Additional MCP servers to register, e.g. a component library's own server. */
	mcpServers?: Record<string, McpServerSpec>;
	/** Skill directories (relative to agent-eval/) installed into the agent's skills root. */
	skillDirs?: string[];
	/** Files written into the sandbox (path → content), e.g. an AGENTS.md docs pointer. */
	extraFiles?: Record<string, string>;
	overrides?: Partial<ExperimentConfig & PostAnalysisExperiment>;
}

// Codex runs direct (the AI Gateway Codex path mis-handles its Responses tool
// shape) with effort folded into the model id; Claude Code runs gateway-routed
// with a separate effort option.
type AgentConfig = Pick<ExperimentConfig, 'agent' | 'model'> &
	Partial<Pick<ExperimentConfig, 'agentOptions'>>;

const AGENT_CONFIG: Record<EvalAgent, AgentConfig> = {
	'claude-code': {
		agent: 'vercel-ai-gateway/claude-code',
		model: 'opus',
		agentOptions: { effort: 'high' },
	},
	codex: {
		agent: 'codex',
		model: 'gpt-5.5?reasoningEffort=medium',
	},
};

// Case-name segments for each AGENT_CONFIG entry, so generated case names
// (`<prefix>-<variant>-<modelSuffix>`) spell out the model and effort the
// entry pins.
export const AGENT_NAME_PARTS: Record<EvalAgent, { prefix: string; modelSuffix: string }> = {
	'claude-code': { prefix: 'cc', modelSuffix: 'opus-high' },
	codex: { prefix: 'codex', modelSuffix: 'gpt-5.5-medium' },
};

// TODO: ⚠️ Change the default to 10 once the eval is more concrete
/** Research sample size, from AGENTIC_REF_RUNS (default 1). */
function resolveRuns(): number {
	const raw = process.env.AGENTIC_REF_RUNS;
	if (raw === undefined || raw === '') {
		return 1;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`AGENTIC_REF_RUNS must be a positive integer; received "${raw}"`);
	}
	return parsed;
}

// Snapshot the fixture's external-repo pin at execution time. The offline
// analyzer compares each run against the ref it actually ran on; without this it
// would have to assume the fixture's pin as it stands today, which retroactively
// changes `before`/`delta` for every historical run whenever the pin moves.
function readExternalRepoPin(fixturePath: string): ExternalRepoPin | null {
	try {
		return parseExternalRepoFromManifest(readFileSync(join(fixturePath, 'package.json'), 'utf8'));
	} catch {
		return null;
	}
}

// The case record persisted into `result.analysis.case`: everything the
// offline analyzer needs to group runs by treatment. Names and paths only —
// file contents already live in the sandbox snapshot.
interface AgenticRefCaseRecord {
	name: string;
	integration: EvalIntegration;
	storybookMcpUrl?: string;
	mcpServers?: string[];
	skillDirs?: string[];
	extraFiles?: string[];
}

// Compose the shared usage hook with the case record so neither clobbers the
// other (a bare override would drop token usage). Heavy metrics, including MCP
// tool usage, are computed offline — see scripts/analyze-results.ts.
function makeAgenticRefMetricsHook(agenticRefCase: AgenticRefCaseRecord) {
	return function attachAgenticRefMetrics(context: RunCompleteContext) {
		const withUsage = DEFAULT_EXPERIMENT_CONFIG.onRunComplete?.(context) ?? context.runData;
		return {
			...withUsage,
			result: {
				...withUsage.result,
				analysis: {
					...withUsage.result.analysis,
					externalRepo: readExternalRepoPin(context.fixture.path),
					case: agenticRefCase,
				},
			},
		};
	};
}

export function agenticRefExperiment(
	options: AgenticRefExperimentOptions,
): ExperimentConfig & PostAnalysisExperiment {
	const { name, evals, storybookMcpUrl, mcpServers, skillDirs, extraFiles, overrides } = options;
	const agent = options.agent ?? 'claude-code';
	const integration = options.integration ?? (storybookMcpUrl ? 'mcp' : 'none');

	async function setup(sandbox: Sandbox): Promise<void> {
		await setupSandbox(sandbox, { agent, integration });
		await setupExternalRepo(sandbox);
		if (storybookMcpUrl) {
			await registerExternalStorybookMcp(sandbox, storybookMcpUrl, agent);
		}
		for (const [serverName, spec] of Object.entries(mcpServers ?? {})) {
			await registerMcpServer(sandbox, agent, serverName, spec);
		}
		for (const skillDir of skillDirs ?? []) {
			await installSkillDir(sandbox, agent, skillDir);
		}
		// After setupExternalRepo so the repo tarball cannot clobber them.
		if (extraFiles && Object.keys(extraFiles).length > 0) {
			await sandbox.writeFiles(extraFiles);
		}
	}

	const caseRecord: AgenticRefCaseRecord = {
		name,
		integration,
		...(storybookMcpUrl !== undefined && { storybookMcpUrl }),
		...(mcpServers && { mcpServers: Object.keys(mcpServers) }),
		...(skillDirs && { skillDirs }),
		...(extraFiles && { extraFiles: Object.keys(extraFiles) }),
	};

	const metricsHook = makeAgenticRefMetricsHook(caseRecord);
	// An override may add its own hook, but the case record must always land in
	// the result — compose instead of letting the override replace the hook.
	const onRunComplete: RunCompleteHook =
		overrides?.onRunComplete === undefined
			? metricsHook
			: (context) => {
					const withMetrics = metricsHook(context);
					return overrides.onRunComplete?.({ ...context, runData: withMetrics }) ?? withMetrics;
				};

	return {
		...DEFAULT_EXPERIMENT_CONFIG,
		...AGENT_CONFIG[agent],
		// Override per experiment to measure one case or prompt differently.
		postAnalysis,
		// The real dependency install outgrows the shared 900s default.
		timeout: 1800,
		// Research, not a CI gate: complete every repetition rather than aborting
		// siblings once one passes.
		runs: resolveRuns(),
		earlyExit: false,
		evals: process.env.EVAL_AGENTIC_REFERENCE === '1' ? evals : [],
		setup,
		...overrides,
		// In-sandbox vitest runs only the fixtures' transcript sanity gate, so a
		// dead agent surfaces as a failed run; the real measurement is offline.
		onRunComplete,
	};
}
