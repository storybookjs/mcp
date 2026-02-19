import * as v from 'valibot';

/**
 * Supported models for the task harness CLI.
 * These names are used consistently across agents - each agent maps them to their native format.
 */
export const SUPPORTED_MODELS = [
	'claude-opus-4.6',
	'claude-opus-4.5',
	'claude-sonnet-4.5',
	'claude-haiku-4.5',
	'gpt-5.2-codex',
	'gpt-5.2',
	'gpt-5.1-codex-max',
	'gemini-3-pro-preview',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

/**
 * Models that are supported by the Claude Code CLI.
 */
export const CLAUDE_MODELS = [
	'claude-opus-4.6',
	'claude-sonnet-4.5',
	'claude-haiku-4.5',
] as const satisfies readonly SupportedModel[];

/**
 * Mapping from our standard model names to Claude CLI --model flag values.
 */
export const CLAUDE_MODEL_MAP: Record<(typeof CLAUDE_MODELS)[number], string> = {
	'claude-opus-4.6': 'Opus',
	'claude-sonnet-4.5': 'Sonnet',
	'claude-haiku-4.5': 'Haiku',
};

export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

/**
 * Models that are supported by the Copilot CLI.
 */
export const COPILOT_MODELS = [
	'claude-opus-4.6',
	'claude-opus-4.5',
	'claude-sonnet-4.5',
	'claude-haiku-4.5',
	'gpt-5.2-codex',
	'gpt-5.2',
	'gpt-5.1-codex-max',
	'gemini-3-pro-preview',
] as const satisfies readonly SupportedModel[];

export type CopilotModel = (typeof COPILOT_MODELS)[number];

export type TrialArgs = {
	trialPath: string;
	taskPath: string;
	projectPath: string;
	resultsPath: string;
	verbose: boolean;
	hooks: Hooks;
	uploadId: string | false;
	runId?: string;
	taskName: string;
	context: Context;
	agent: string;
	model: SupportedModel;
	label?: string;
};

export type ExecutionSummary = {
	agent: string;
	model: string;
	cost?: number;
	duration: number;
	durationApi: number;
	turns: number;
};

export type GradingSummary = {
	buildSuccess: boolean;
	typeCheckErrors: number;
	lintErrors: number;
	test: {
		passed: number;
		failed: number;
	};
	a11y: {
		violations: number;
	};
	/** Optional LLM-judge result (configurable per task). */
	judge?: {
		/** Normalized score from 0 (worst) to 1 (best). */
		score: number;
		/** Reasoning text from the judge for why this score was assigned. */
		reason: string;
		/** Model identifier used by the judge runner. */
		model: SupportedModel;
		/** Agent runner used for the judge (e.g. copilot-cli). */
		agent: string;
	};
	coverage?: {
		branches: number | null;
		functions: number | null;
		lines: number | null;
		statements: number | null;
	};
	componentUsage?: {
		score: number;
		matched: number;
		missing: number;
		unexpected: number;
	};
	mcpTools?: McpToolsSummary;
	/** Quality result with score and description, calculated via hooks.calculateQuality */
	quality?: QualityResult;
};

/**
 * Result from a quality calculation.
 * Includes a normalized score (0-1) and a description explaining what it's based on.
 */
export type QualityResult = {
	/** Normalized score from 0 (worst) to 1 (best) */
	score: number;
	/** Human-readable description of what the quality is based on */
	description: string;
};

/**
 * Expectation for an MCP tool call.
 * Tool names are matched using includes() to handle MCP server prefixes
 * (e.g., "mcp__list_components" matches expected "list_components").
 */
export type McpToolExpectation = {
	/** Minimum number of calls required for this tool */
	minCalls?: number;
	/** Maximum number of calls allowed for this tool */
	maxCalls?: number;
	/**
	 * Expected calls to this tool (array of expected input patterns).
	 * Matching is deep-partial: only the keys present in the expected input are validated.
	 */
	expectedCalls?: Array<Record<string, unknown>>;
	/** Maximum allowed output tokens for this tool (expect less than X) */
	maxOutputTokens?: number;
};

/**
 * Record of a single MCP tool invocation during execution.
 */
export type McpToolInvocation = {
	/** Full tool name including MCP prefix (e.g., "mcp__list_components") */
	name: string;
	/** Input parameters passed to the tool */
	input: Record<string, unknown>;
	/** Token count of the tool's output */
	outputTokens: number;
};

/**
 * Aggregated metrics for a single MCP tool across all invocations.
 */
export type McpToolMetrics = {
	/** Tool name (short form, without MCP prefix) */
	name: string;
	/** Full tool name including MCP prefix */
	fullName: string;
	/** Number of times this tool was called */
	callCount: number;
	/** Total output tokens across all calls */
	totalOutputTokens: number;
	/** Individual invocations with their inputs */
	invocations: Array<{
		input: Record<string, unknown>;
		outputTokens: number;
	}>;
	/** Validation results if expectations are configured */
	validation?: {
		minCallsMet?: boolean;
		maxCallsMet?: boolean;
		inputMatch?: boolean;
		outputTokensWithinLimit?: boolean;
	};
};

/**
 * Summary of all MCP tool usage during execution.
 */
export type McpToolsSummary = {
	/** Aggregated metrics per unique tool */
	tools: McpToolMetrics[];
	/** Total number of MCP tool calls */
	totalCalls: number;
	/** Total output tokens across all MCP tools */
	totalOutputTokens: number;
	/** Whether all expectations passed (undefined if no expectations configured) */
	allExpectationsPassed?: boolean;
	/** Number of expected tools configured */
	expectedToolCount?: number;
	/** Number of expected tools that were actually called */
	calledExpectedToolCount?: number;
};

/**
 * Configuration for a task, loaded from config.json in the task directory.
 */
export type TaskConfig = {
	expectedImports?: Record<string, string[]>;
	/**
	 * Expected MCP tool calls. Keys are tool name substrings (matched via includes()).
	 * All fields are optional - only validate what's configured.
	 */
	expectedMcpTools?: Record<string, McpToolExpectation>;
};

export const McpServerConfigSchema = v.record(
	v.string(),
	v.union([
		v.object({
			type: v.literal('http'),
			url: v.string(),
			headers: v.optional(v.record(v.string(), v.string())),
		}),
		v.object({
			type: v.literal('stdio'),
			command: v.string(),
			args: v.optional(v.array(v.string())),
			env: v.optional(v.string()),
		}),
	]),
);
export type McpServerConfig = v.InferOutput<typeof McpServerConfigSchema>;

export type ContextItem =
	| {
			type: false;
	  }
	| {
			type: 'inline-prompt';
			content: string;
	  }
	| {
			type: 'extra-prompts';
			prompts: string[];
	  }
	| {
			type: 'mcp-server';
			mcpServerConfig: McpServerConfig;
	  }
	| {
			type: 'storybook-mcp-docs';
	  }
	| {
			type: 'storybook-mcp-dev';
	  };

export type Context = ContextItem[];

export interface Agent {
	execute: (
		prompt: string,
		trialArgs: TrialArgs,
		mcpServerConfig?: McpServerConfig,
	) => Promise<ExecutionSummary>;
}

export type Hook = (trialArgs: TrialArgs) => Promise<void>;

/**
 * Arguments passed to the calculateQuality function.
 * Contains all information from execution and grading phases.
 */
export type QualityArgs = {
	/** Trial arguments including paths, context, etc. */
	trialArgs: TrialArgs;
	/** Summary from the execution phase */
	execution: ExecutionSummary;
	/** Summary from the grading phase */
	grading: GradingSummary;
};

/**
 * Function to calculate a quality result for a trial.
 * Returns a QualityResult with score (0-1) and description, or undefined to skip.
 */
export type CalculateQualityFn = (args: QualityArgs) => QualityResult | undefined;

export type Hooks = Partial<{
	prePrepareTrial: Hook;
	postPrepareTrial: Hook;
	preExecuteAgent: Hook;
	postExecuteAgent: Hook;
	preGrade: Hook;
	postGrade: Hook;
	preSave: Hook;
	postSave: Hook;
	/**
	 * Calculate a quality result for the trial.
	 * Called after grading, result is included in summary.json.
	 */
	calculateQuality: CalculateQualityFn;
}>;
