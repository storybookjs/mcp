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
