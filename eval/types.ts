import type { taskLog } from '@clack/prompts';
import * as v from 'valibot';
import type { TaskLogger } from './lib/evaluations/evaluate';

export type ExperimentArgs = {
	experimentPath: string;
	evalPath: string;
	projectPath: string;
	resultsPath: string;
	verbose: boolean;
	description?: string;
	hooks: Hooks;
	uploadResults: boolean;
	evalName: string;
	context: Context;
	agent: string;
};

export type ExecutionSummary = {
	cost: number;
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
	}
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
export type McpServerConfig = v.InferOutput<typeof McpServerConfigSchema>;

export type Context =
	| {
			type: false;
	  }
	| {
			type: 'extra-prompts';
			prompts: string[];
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

export type Hook = (
	experimentArgs: ExperimentArgs,
	log: ReturnType<typeof taskLog>,
) => Promise<void>;

export type Hooks = {
	prePrepareExperiment?: Hook;
	postPrepareExperiment?: Hook;
	preExecuteAgent?: Hook;
	postExecuteAgent?: Hook;
	preEvaluate?: (
		experimentArgs: ExperimentArgs,
		log: TaskLogger,
	) => Promise<void>;
	postEvaluate?: (
		experimentArgs: ExperimentArgs,
		log: TaskLogger,
	) => Promise<void>;
};
