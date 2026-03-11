import type { VariantConfigInput, VariantInput } from '../lib/eval/types.ts';

const base = {
	agent: 'claude-code',
	model: 'claude-sonnet-4.6',
	verbose: false,
	storybook: false,
	systemPrompts: [],
	context: [
		{ type: 'storybook-mcp-dev' },
		{ type: 'extra-prompts', prompts: ['prompt.concise.md'] },
	],
} satisfies Partial<VariantInput>;

const config = {
	name: 'component-concise-reshaped-internal',
	description:
		'Internal matrix for reshaped component tasks (901-907) using concise prompt variants.',
	internal: true,
	variants: [
		{
			...base,
			id: '901-concise',
			label: '901 Create Atom Component (Concise)',
			taskName: '901-create-component-atom-reshaped',
		},
		{
			...base,
			id: '902-concise',
			label: '902 Create Composite Component (Concise)',
			taskName: '902-create-component-composite-reshaped',
		},
		{
			...base,
			id: '903-concise',
			label: '903 Create Async Fetch Component (Concise)',
			taskName: '903-create-component-async-fetch-reshaped',
		},
		{
			...base,
			id: '904-concise',
			label: '904 Create Async Module Component (Concise)',
			taskName: '904-create-component-async-module-reshaped',
		},
		{
			...base,
			id: '905-concise',
			label: '905 Write Stories For Existing Component (Concise)',
			taskName: '905-existing-component-write-story-reshaped',
		},
		{
			...base,
			id: '906-concise',
			label: '906 Edit Existing Stories (Concise)',
			taskName: '906-existing-component-edit-story-reshaped',
		},
		{
			...base,
			id: '907-concise',
			label: '907 Change Component And Stories (Concise)',
			taskName: '907-existing-component-change-component-reshaped',
		},
	],
} satisfies VariantConfigInput;

export default config;
