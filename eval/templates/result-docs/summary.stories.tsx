import type { Meta, StoryObj } from '@storybook/react-vite';
import { Summary } from './summary';

const meta = {
	title: 'Result Docs/Summary',
	component: Summary,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof Summary>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A perfect evaluation with all checks passing and no errors.
 */
export const AllPassing: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.2543,
		duration: 245,
		durationApi: 198,
		turns: 12,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 15,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
	},
};

/**
 * Build failed, preventing other checks from running properly.
 */
export const BuildFailure: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.1234,
		duration: 120,
		durationApi: 95,
		turns: 8,
		buildSuccess: false,
		typeCheckErrors: 3,
		lintErrors: 5,
		test: {
			passed: 0,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
	},
};

/**
 * Build succeeded but has type checking errors.
 */
export const TypeCheckErrors: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.3421,
		duration: 312,
		durationApi: 245,
		turns: 15,
		buildSuccess: true,
		typeCheckErrors: 7,
		lintErrors: 0,
		test: {
			passed: 12,
			failed: 0,
		},
		a11y: {
			violations: 2,
		},
	},
};

/**
 * Build succeeded but has linting errors.
 */
export const LintErrors: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.2876,
		duration: 267,
		durationApi: 213,
		turns: 13,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 12,
		test: {
			passed: 10,
			failed: 2,
		},
		a11y: {
			violations: 1,
		},
	},
};

/**
 * Tests failed to run (no passed or failed tests).
 */
export const TestsFailedToRun: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.1567,
		duration: 156,
		durationApi: 124,
		turns: 9,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 0,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
	},
};

/**
 * Some tests failed but build and type checks passed.
 */
export const SomeTestsFailed: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.4123,
		duration: 389,
		durationApi: 312,
		turns: 18,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 8,
			failed: 4,
		},
		a11y: {
			violations: 3,
		},
	},
};

/**
 * Everything passed except accessibility violations.
 */
export const AccessibilityViolations: Story = {
	args: {
		agent: 'Copilot CLI',
		model: 'gpt-5.1-codex-max',
		cost: 0.3298,
		duration: 298,
		durationApi: 234,
		turns: 14,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 20,
			failed: 0,
		},
		a11y: {
			violations: 8,
		},
	},
};

/**
 * Multiple failures across different checks.
 */
export const MultipleFailures: Story = {
	args: {
		agent: 'Copilot CLI',
		model: 'claude-opus-4.5',
		cost: 0.5621,
		duration: 512,
		durationApi: 423,
		turns: 22,
		buildSuccess: false,
		typeCheckErrors: 15,
		lintErrors: 23,
		test: {
			passed: 3,
			failed: 12,
		},
		a11y: {
			violations: 6,
		},
	},
};

/**
 * Shows MCP tools usage without any expectations configured.
 * Just displays which tools were called and their token counts.
 */
export const WithMcpToolsNoExpectations: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.3456,
		duration: 289,
		durationApi: 234,
		turns: 14,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 18,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
		mcpTools: {
			tools: [
				{
					name: 'list-all-documentation',
					fullName: 'mcp__storybook__list-all-documentation',
					callCount: 1,
					totalOutputTokens: 12500,
					invocations: [{ input: {}, outputTokens: 12500 }],
				},
				{
					name: 'get-documentation',
					fullName: 'mcp__storybook__get-documentation',
					callCount: 3,
					totalOutputTokens: 4200,
					invocations: [
						{ input: { id: 'button' }, outputTokens: 1400 },
						{ input: { id: 'calendar' }, outputTokens: 1500 },
						{ input: { id: 'autocomplete' }, outputTokens: 1300 },
					],
				},
			],
			totalCalls: 4,
			totalOutputTokens: 16700,
		},
	},
};

/**
 * Shows MCP tools usage where all expectations pass.
 * Tools were called with expected inputs and within token limits.
 */
export const WithMcpToolsExpectationsPassed: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.2987,
		duration: 267,
		durationApi: 212,
		turns: 12,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 15,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
		mcpTools: {
			tools: [
				{
					name: 'list-all-documentation',
					fullName: 'mcp__storybook__list-all-documentation',
					callCount: 1,
					totalOutputTokens: 8500,
					invocations: [{ input: {}, outputTokens: 8500 }],
					validation: {
						outputTokensWithinLimit: true,
					},
				},
				{
					name: 'get-documentation',
					fullName: 'mcp__storybook__get-documentation',
					callCount: 2,
					totalOutputTokens: 2800,
					invocations: [
						{ input: { id: 'button' }, outputTokens: 1400 },
						{ input: { id: 'popover' }, outputTokens: 1400 },
					],
					validation: {
						inputMatch: true,
						outputTokensWithinLimit: true,
					},
				},
			],
			totalCalls: 3,
			totalOutputTokens: 11300,
			allExpectationsPassed: true,
		},
	},
};

/**
 * Shows MCP tools usage where some expectations failed.
 * Output tokens exceeded the configured limit.
 */
export const WithMcpToolsExpectationsFailed: Story = {
	args: {
		agent: 'Claude Code v1.0.37',
		model: 'claude-sonnet-4-20250514',
		cost: 0.4123,
		duration: 345,
		durationApi: 289,
		turns: 16,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 2,
		test: {
			passed: 12,
			failed: 2,
		},
		a11y: {
			violations: 1,
		},
		mcpTools: {
			tools: [
				{
					name: 'list-all-documentation',
					fullName: 'mcp__storybook__list-all-documentation',
					callCount: 2,
					totalOutputTokens: 65000,
					invocations: [
						{ input: {}, outputTokens: 32000 },
						{ input: {}, outputTokens: 33000 },
					],
					validation: {
						outputTokensWithinLimit: false,
					},
				},
				{
					name: 'get-documentation',
					fullName: 'mcp__storybook__get-documentation',
					callCount: 5,
					totalOutputTokens: 7500,
					invocations: [
						{ input: { id: 'button' }, outputTokens: 1500 },
						{ input: { id: 'calendar' }, outputTokens: 1500 },
						{ input: { id: 'autocomplete' }, outputTokens: 1500 },
						{ input: { id: 'popover' }, outputTokens: 1500 },
						{ input: { id: 'view' }, outputTokens: 1500 },
					],
					validation: {
						inputMatch: true,
						outputTokensWithinLimit: true,
					},
				},
			],
			totalCalls: 7,
			totalOutputTokens: 72500,
			allExpectationsPassed: false,
		},
	},
};

/**
 * Shows a single MCP tool with many invocations.
 */
export const WithMcpToolsManyInvocations: Story = {
	args: {
		agent: 'Copilot CLI',
		model: 'gpt-5.1-codex-max',
		cost: 0.5234,
		duration: 423,
		durationApi: 378,
		turns: 20,
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: {
			passed: 22,
			failed: 0,
		},
		a11y: {
			violations: 0,
		},
		mcpTools: {
			tools: [
				{
					name: 'get-documentation',
					fullName: 'mcp__storybook__get-documentation',
					callCount: 8,
					totalOutputTokens: 11200,
					invocations: [
						{ input: { id: 'button' }, outputTokens: 1400 },
						{ input: { id: 'calendar' }, outputTokens: 1400 },
						{ input: { id: 'autocomplete' }, outputTokens: 1400 },
						{ input: { id: 'popover' }, outputTokens: 1400 },
						{ input: { id: 'view' }, outputTokens: 1400 },
						{ input: { id: 'toggle-button' }, outputTokens: 1400 },
						{ input: { id: 'toggle-button-group' }, outputTokens: 1400 },
						{ input: { id: 'dialog' }, outputTokens: 1400 },
					],
				},
			],
			totalCalls: 8,
			totalOutputTokens: 11200,
		},
	},
};
