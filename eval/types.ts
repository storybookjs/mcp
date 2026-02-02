import * as v from 'valibot';

/**
 * Supported models for the task harness CLI.
 * These names are used consistently across agents - each agent maps them to their native format.
 */
export const SUPPORTED_MODELS = [
	'claude-sonnet-4.5',
	'claude-opus-4.5',
	'claude-haiku-4.5',
	'gpt-5.1-codex-max',
	'gpt-5.1-codex',
	'gpt-5.2',
	'gemini-3-pro-preview',
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

/**
 * Models that are supported by the Claude Code CLI.
 */
export const CLAUDE_MODELS = [
	'claude-sonnet-4.5',
	'claude-opus-4.5',
	'claude-haiku-4.5',
] as const satisfies readonly SupportedModel[];

export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

/**
 * Models that are supported by the Copilot CLI.
 */
export const COPILOT_MODELS = [
	'claude-sonnet-4.5',
	'claude-opus-4.5',
	'claude-haiku-4.5',
	'gpt-5.1-codex-max',
	'gpt-5.1-codex',
	'gpt-5.2',
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
};

/**
 * Expectation for an MCP tool call.
 * Tool names are matched using includes() to handle MCP server prefixes
 * (e.g., "mcp__list_components" matches expected "list_components").
 */
export type McpToolExpectation = {
	/** Expected calls to this tool (array of expected inputs, strict equality check) */
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

export type Hooks = {
	prePrepareTrial?: Hook;
	postPrepareTrial?: Hook;
	preExecuteAgent?: Hook;
	postExecuteAgent?: Hook;
	preGrade?: Hook;
	postGrade?: Hook;
	preSave?: Hook;
	postSave?: Hook;
};
