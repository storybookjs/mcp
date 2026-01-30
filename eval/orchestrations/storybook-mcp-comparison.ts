import type {
	OrchestrationConfig,
	OrchestrationVariant,
} from '../lib/orchestrate/types.ts';

const base = {
	agent: 'claude-code',
	model: 'claude-opus-4.5',
	verbose: false,
	storybook: false,
	systemPrompts: [],
} satisfies Partial<OrchestrationVariant>;

const config = {
	name: 'storybook-mcp-comparison',
	description:
		'Compare eval performance with and without the Storybook Docs MCP Server enabled.',
	variants: [
		{
			...base,
			id: 'without-mcp',
			label: 'Without MCP',
			context: [
				{
					type: 'inline-prompt',
					content:
						"To get information about the design system, inspect the local project and package.json, where you'll find all the components. Don't use any pre-existing knowledge about the design system to perform the task.",
				},
			],
		},
		{
			...base,
			id: 'with-mcp',
			label: 'With Storybook MCP Docs',
			context: [
				{ type: 'storybook-mcp-docs' },
				{
					type: 'inline-prompt',
					content:
						'Use `storybook-docs-mcp` tool `list-all-documentation` and `get-component-documentation` to get information about the used design system components and figure out how to use them before importing components from a design system.',
				},
			],
		},
	],
} satisfies OrchestrationConfig;

export default config;
