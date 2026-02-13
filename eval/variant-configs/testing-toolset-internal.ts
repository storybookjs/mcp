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
	name: 'testing-toolset-internal',
	description:
		'Internal matrix for testing-toolset eval tasks (908-912) with prompt-variant combinations.',
	internal: true,
	variants: [
		{
			...base,
			id: '908-default',
			label: '908 Run Story Tests',
			taskName: '908-run-story-tests',
		},
		{
			...base,
			id: '909-default',
			label: '909 Run Tests After Component Creation',
			taskName: '909-run-tests-after-component-creation',
		},
		{
			...base,
			id: '910-concise',
			label: '910 Tests Without A11y (Concise)',
			taskName: '910-run-tests-without-a11y',
			context: [
				{ type: 'storybook-mcp-dev' },
				{ type: 'extra-prompts', prompts: ['prompt.concise.md'] },
			],
		},
		{
			...base,
			id: '910-explicit',
			label: '910 Tests Without A11y (Explicit)',
			taskName: '910-run-tests-without-a11y',
			context: [
				{ type: 'storybook-mcp-dev' },
				{ type: 'extra-prompts', prompts: ['prompt.explicit.md'] },
			],
		},
		{
			...base,
			id: '910-system-a11y-false',
			label: '910 Tests Without A11y (System Prompt)',
			taskName: '910-run-tests-without-a11y',
			systemPrompts: ['system.a11y-false.md'],
		},
		{
			...base,
			id: '911-default',
			label: '911 Fix Failing Tests',
			taskName: '911-fix-failing-tests',
		},
		{
			...base,
			id: '912-default',
			label: '912 Fix A11y Violations',
			taskName: '912-fix-a11y-violations',
		},
		{
			...base,
			id: '912-explicit',
			label: '912 Fix A11y Violations (Explicit)',
			taskName: '912-fix-a11y-violations',
			context: [
				{ type: 'storybook-mcp-dev' },
				{ type: 'extra-prompts', prompts: ['prompt.explicit.md'] },
			],
		},
	],
} satisfies VariantConfigInput;

export default config;
