import type { Context, SupportedModel } from '../../types.ts';
import type { agents } from '../../config.ts';

export type AgentName = keyof typeof agents;

/** Normalized variant with required agent/model - used after collectEvalArgs */
export type Variant = {
	id: string;
	label: string;
	context: Context;
	agent: AgentName;
	model: SupportedModel;
	verbose?: boolean;
	storybook?: boolean;
	systemPrompts?: string[];
};

/** Input variant from config files - agent/model are optional (filled in by prompt) */
export type VariantInput = Omit<Variant, 'agent' | 'model'> & {
	agent?: AgentName;
	model?: SupportedModel;
};

/** Normalized config with required agent/model - used in EvalArgs */
export type VariantConfig = {
	name: string;
	description?: string;
	variants: Variant[];
};

/** Config file structure - uses VariantInput */
export type VariantConfigInput = Omit<VariantConfig, 'variants'> & {
	variants: VariantInput[];
};

export type EvalArgs = {
	taskName: string;
	config: VariantConfig;
	iterations: number;
	uploadId: string | false;
	runId: string;
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
	label?: string;
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
