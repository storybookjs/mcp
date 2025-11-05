import * as v from 'valibot';

export type ExperimentArgs = {
	experimentPath: string;
	evalPath: string;
	projectPath: string;
	resultsPath: string;
	verbose: boolean;
};

export type ExecutionSummary = {
	cost: number;
	duration: number;
	durationApi: number;
	turns: number;
};

export type EvaluationSummary = {
	buildSuccess: boolean;
	typeCheckSuccess: boolean;
	lintSuccess: boolean;
	testSuccess: boolean;
	a11ySuccess: boolean;
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
			args: v.optional(v.string()),
			env: v.optional(v.string()),
		}),
	]),
);
type McpServerConfig = v.InferOutput<typeof McpServerConfigSchema>;

export type Context =
	| {
			type: false;
	  }
	| {
			type: 'extra-prompts';
			contents: string[];
	  }
	| {
			type: 'mcp-server';
			mcpServerConfig: McpServerConfig;
	  };

export interface Agent {
	execute: (
		prompt: string,
		experimentArgs: ExperimentArgs,
    mcpServerConfig?: McpServerConfig,
	) => Promise<ExecutionSummary>;
}
