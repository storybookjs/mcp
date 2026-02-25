import type { VariantConfigInput, VariantInput } from '../lib/eval/types.ts';

const base = {
	agent: 'claude-code',
	model: 'claude-sonnet-4.5',
	verbose: false,
	storybook: false,
	systemPrompts: [],
	context: [{ type: 'storybook-mcp-dev' }],
} satisfies Partial<VariantInput>;

const config = {
	name: 'preview-by-id-internal',
	description:
		'Internal matrix for preview-by-id eval tasks (914-915) with prompt-variant combinations.',
	internal: true,
	variants: [
		{
			...base,
			id: '914-default',
			label: '914 Preview Story By Path',
			taskName: '914-preview-story-by-path',
		},
		{
			...base,
			id: '915-default',
			label: '915 Preview Story By ID (v2)',
			taskName: '915-preview-story-by-id',
		},
		{
			...base,
			id: '915-props-first',
			label: '915 Preview Story By ID (Docs First)',
			taskName: '915-preview-story-by-id',
			context: [
				{ type: 'storybook-mcp-dev' },
				{ type: 'extra-prompts', prompts: ['prompt.docs-first.md'] },
			],
		},
	],
} satisfies VariantConfigInput;

export default config;
