// Shared experiment shape for agentic-reference evals. `storybookMcpUrl` is the
// arm selector: present = MCP arm (also flips the `integration: 'mcp'` context
// flag), absent = no-MCP control arm. Gated behind EVAL_AGENTIC_REFERENCE=1 so
// the default matrix never spends on it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExperimentConfig, RunCompleteContext, Sandbox } from '@vercel/agent-eval';
import { DEFAULT_EXPERIMENT_CONFIG } from '../experiment.ts';
import { type EvalAgent, setupSandbox } from '../templates.ts';
import {
	type ExternalRepoPin,
	parseExternalRepoFromManifest,
	setupExternalRepo,
} from './external-repo.ts';
import { registerExternalStorybookMcp } from './external-mcp.ts';
import { postAnalysis } from './post-analysis.ts';

import type { PostAnalysisExperiment } from '../post-analysis/types.ts';

interface AgenticRefExperimentOptions {
	evals: string[];
	/** Coding agent to evaluate. Default 'claude-code'. */
	agent?: EvalAgent;
	/** Present = MCP arm, absent = control arm. */
	storybookMcpUrl?: string;
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

// Captured files are raw bytes — the harness stopped UTF-8 decoding them so that
// binary assets survive collection — so decode explicitly before parsing.
function readMetric(generatedFiles: Record<string, Buffer> | undefined, path: string): unknown {
	try {
		return JSON.parse(generatedFiles?.[path]?.toString('utf8') ?? 'null');
	} catch {
		return null;
	}
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

// Compose the shared usage hook with the in-run signal (mcpUsage) so neither
// clobbers the other (a bare override would drop token usage). Heavy metrics
// (app tests, baseline) are computed offline — see scripts/analyze-results.ts.
function attachAgenticRefMetrics(context: RunCompleteContext) {
	const withUsage = DEFAULT_EXPERIMENT_CONFIG.onRunComplete?.(context) ?? context.runData;
	return {
		...withUsage,
		result: {
			...withUsage.result,
			analysis: {
				...withUsage.result.analysis,
				mcpUsage: readMetric(withUsage.generatedFiles, '__metrics__/mcp-usage.json'),
				externalRepo: readExternalRepoPin(context.fixture.path),
			},
		},
	};
}

export function agenticRefExperiment(
	options: AgenticRefExperimentOptions,
): ExperimentConfig & PostAnalysisExperiment {
	const { evals, storybookMcpUrl, overrides } = options;
	const agent = options.agent ?? 'claude-code';

	async function setup(sandbox: Sandbox): Promise<void> {
		await setupSandbox(sandbox, {
			agent,
			integration: storybookMcpUrl ? 'mcp' : 'plugin',
		});
		await setupExternalRepo(sandbox);
		if (storybookMcpUrl) {
			await registerExternalStorybookMcp(sandbox, storybookMcpUrl, agent);
		}
	}

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
		onRunComplete: attachAgenticRefMetrics,
		evals: process.env.EVAL_AGENTIC_REFERENCE === '1' ? evals : [],
		setup,
		...overrides,
	};
}
