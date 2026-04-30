import type { VariantConfigInput, VariantInput } from '../lib/eval/types.ts';

const base = {
	agent: 'claude-code',
	model: 'claude-sonnet-4.6',
	verbose: false,
	storybook: false,
	systemPrompts: [],
	context: [{ type: 'storybook-mcp-docs' }],
} satisfies Partial<VariantInput>;

const config = {
	name: 'setup-instructions-temp-internal',
	description:
		'Temporary internal config for running task 916 with Claude Code on Claude Sonnet 4.6.',
	internal: true,
	variants: [
		{
			...base,
			id: '916-default',
			label: '916 Follow Setup Instructions',
			taskName: '916-follow-setup-instructions',
		},
	],
} satisfies VariantConfigInput;

export default config;
