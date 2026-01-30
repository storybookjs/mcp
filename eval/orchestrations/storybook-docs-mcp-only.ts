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
	name: 'storybook-docs-mcp-only',
	description: 'Storybook Docs MCP Server only',
	variants: [
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
