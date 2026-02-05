import type { Meta, StoryObj } from '@storybook/react-vite';
import { Lint } from './lint';

const meta = {
	title: 'Result Docs/Lint',
	component: Lint,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof Lint>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * All linting checks passed with no errors or warnings.
 */
export const AllPassing: Story = {
	args: {
		success: true,
		errorCount: 0,
		warningCount: 0,
		fixableErrorCount: 0,
		fixableWarningCount: 0,
		files: [],
	},
};

/**
 * Single linting error that is fixable.
 */
export const SingleFixableError: Story = {
	args: {
		success: false,
		errorCount: 1,
		warningCount: 0,
		fixableErrorCount: 1,
		fixableWarningCount: 0,
		files: [
			{
				filePath: 'src/components/Button.tsx',
				errorCount: 1,
				warningCount: 0,
				messages: [
					{
						ruleId: 'quotes',
						severity: 2,
						message: 'Strings must use singlequote.',
						line: 23,
						column: 15,
					},
				],
			},
		],
	},
};

/**
 * Multiple errors in one file.
 */
export const MultipleErrorsInOneFile: Story = {
	args: {
		success: false,
		errorCount: 4,
		warningCount: 0,
		fixableErrorCount: 2,
		fixableWarningCount: 0,
		files: [
			{
				filePath: 'src/components/Form.tsx',
				errorCount: 4,
				warningCount: 0,
				messages: [
					{
						ruleId: 'no-unused-vars',
						severity: 2,
						message: "'React' is defined but never used.",
						line: 1,
						column: 8,
					},
					{
						ruleId: 'quotes',
						severity: 2,
						message: 'Strings must use singlequote.',
						line: 12,
						column: 20,
					},
					{
						ruleId: 'no-console',
						severity: 2,
						message: 'Unexpected console statement.',
						line: 34,
						column: 3,
					},
					{
						ruleId: 'react-hooks/exhaustive-deps',
						severity: 2,
						message: "React Hook useEffect has a missing dependency: 'fetchData'.",
						line: 45,
						column: 6,
					},
				],
			},
		],
	},
};

/**
 * Errors across multiple files.
 */
export const ErrorsInMultipleFiles: Story = {
	args: {
		success: false,
		errorCount: 6,
		warningCount: 0,
		fixableErrorCount: 3,
		fixableWarningCount: 0,
		files: [
			{
				filePath: 'src/components/Button.tsx',
				errorCount: 2,
				warningCount: 0,
				messages: [
					{
						ruleId: 'quotes',
						severity: 2,
						message: 'Strings must use singlequote.',
						line: 23,
						column: 15,
					},
					{
						ruleId: 'semi',
						severity: 2,
						message: 'Missing semicolon.',
						line: 45,
						column: 23,
					},
				],
			},
			{
				filePath: 'src/components/Input.tsx',
				errorCount: 3,
				warningCount: 0,
				messages: [
					{
						ruleId: 'no-unused-vars',
						severity: 2,
						message: "'useState' is defined but never used.",
						line: 1,
						column: 17,
					},
					{
						ruleId: 'react/prop-types',
						severity: 2,
						message: "'value' is missing in props validation.",
						line: 8,
						column: 3,
					},
					{
						ruleId: 'indent',
						severity: 2,
						message: 'Expected indentation of 2 spaces but found 4.',
						line: 15,
						column: 1,
					},
				],
			},
			{
				filePath: 'src/utils/helpers.ts',
				errorCount: 1,
				warningCount: 0,
				messages: [
					{
						ruleId: 'no-console',
						severity: 2,
						message: 'Unexpected console statement.',
						line: 12,
						column: 5,
					},
				],
			},
		],
	},
};

/**
 * Warnings only (no errors).
 */
export const WarningsOnly: Story = {
	args: {
		success: true,
		errorCount: 0,
		warningCount: 3,
		fixableErrorCount: 0,
		fixableWarningCount: 2,
		files: [
			{
				filePath: 'src/components/Card.tsx',
				errorCount: 0,
				warningCount: 3,
				messages: [
					{
						ruleId: 'no-debugger',
						severity: 1,
						message: "Unexpected 'debugger' statement.",
						line: 18,
						column: 3,
					},
					{
						ruleId: 'prefer-const',
						severity: 1,
						message: "'title' is never reassigned. Use 'const' instead.",
						line: 25,
						column: 7,
					},
					{
						ruleId: 'no-var',
						severity: 1,
						message: 'Unexpected var, use let or const instead.',
						line: 32,
						column: 5,
					},
				],
			},
		],
	},
};

/**
 * Mix of errors and warnings across multiple files.
 */
export const ErrorsAndWarnings: Story = {
	args: {
		success: false,
		errorCount: 3,
		warningCount: 4,
		fixableErrorCount: 2,
		fixableWarningCount: 3,
		files: [
			{
				filePath: 'src/components/Modal.tsx',
				errorCount: 2,
				warningCount: 1,
				messages: [
					{
						ruleId: 'quotes',
						severity: 2,
						message: 'Strings must use singlequote.',
						line: 15,
						column: 20,
					},
					{
						ruleId: 'no-unused-vars',
						severity: 2,
						message: "'isOpen' is assigned a value but never used.",
						line: 23,
						column: 9,
					},
					{
						ruleId: 'prefer-const',
						severity: 1,
						message: "'content' is never reassigned. Use 'const' instead.",
						line: 34,
						column: 7,
					},
				],
			},
			{
				filePath: 'src/components/Tooltip.tsx',
				errorCount: 1,
				warningCount: 3,
				messages: [
					{
						ruleId: 'semi',
						severity: 2,
						message: 'Missing semicolon.',
						line: 12,
						column: 45,
					},
					{
						ruleId: 'no-var',
						severity: 1,
						message: 'Unexpected var, use let or const instead.',
						line: 18,
						column: 3,
					},
					{
						ruleId: 'eqeqeq',
						severity: 1,
						message: "Expected '===' and instead saw '=='.",
						line: 25,
						column: 10,
					},
					{
						ruleId: 'arrow-body-style',
						severity: 1,
						message: 'Unexpected block statement surrounding arrow body.',
						line: 32,
						column: 28,
					},
				],
			},
		],
	},
};

/**
 * No rule ID errors (parser or plugin errors).
 */
export const ParserErrors: Story = {
	args: {
		success: false,
		errorCount: 2,
		warningCount: 0,
		fixableErrorCount: 0,
		fixableWarningCount: 0,
		files: [
			{
				filePath: 'src/components/Broken.tsx',
				errorCount: 2,
				warningCount: 0,
				messages: [
					{
						ruleId: null,
						severity: 2,
						message: 'Parsing error: Unexpected token',
						line: 12,
						column: 5,
					},
					{
						ruleId: null,
						severity: 2,
						message: 'Parsing error: Missing semicolon',
						line: 18,
						column: 15,
					},
				],
			},
		],
	},
};
