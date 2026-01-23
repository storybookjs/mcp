import type { Context, SupportedModel } from '../../types.ts';
import type { agents } from '../../config.ts';

export type AgentName = keyof typeof agents;

export type OrchestrationVariant = {
	id: string;
	label: string;
	context: Context;
	agent: AgentName;
	model: SupportedModel;
	verbose?: boolean;
	storybook?: boolean;
	systemPrompts?: string[];
};

export type OrchestrationConfig = {
	name: string;
	description?: string;
	variants: OrchestrationVariant[];
};

export type OrchestrationArgs = {
	evalName: string;
	config: OrchestrationConfig;
	iterations: number;
	uploadId: string | false;
	runId: string;
	advancedMode: boolean;
	designSystem?: string;
	selectedVariants?: string[];
	inlinePrompt?: string;
};

export type RunRequest = {
	id: string;
	variantId: string;
	variantLabel: string;
	iteration: number;
	context: Context;
	agent: AgentName;
	model: SupportedModel;
	verbose?: boolean;
	storybook?: boolean;
	systemPrompts?: string[];
};

export type RunStatus = 'pending' | 'running' | 'success' | 'failed';

export type RunProgress = {
	request: RunRequest;
	status: RunStatus;
	startedAt?: number;
	finishedAt?: number;
	error?: string;
	durationSeconds?: number;
	cost?: number;
	turns?: number;
};
