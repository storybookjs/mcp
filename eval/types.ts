import * as v from 'valibot';

/**
 * Supported models for the eval CLI.
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

export type ExperimentArgs = {
	experimentPath: string;
	evalPath: string;
	projectPath: string;
	resultsPath: string;
	verbose: boolean;
	hooks: Hooks;
	uploadId: string | false;
	runId?: string;
	evalName: string;
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

export type EvaluationSummary = {
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
};

/**
 * Configuration for an evaluation, loaded from config.json in the eval directory.
 */
export type EvalConfig = {
	expectedImports?: Record<string, string[]>;
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
		experimentArgs: ExperimentArgs,
		mcpServerConfig?: McpServerConfig,
	) => Promise<ExecutionSummary>;
}

export type Hook = (experimentArgs: ExperimentArgs) => Promise<void>;

export type Hooks = {
	prePrepareExperiment?: Hook;
	postPrepareExperiment?: Hook;
	preExecuteAgent?: Hook;
	postExecuteAgent?: Hook;
	preEvaluate?: Hook;
	postEvaluate?: Hook;
	preSave?: Hook;
	postSave?: Hook;
};
