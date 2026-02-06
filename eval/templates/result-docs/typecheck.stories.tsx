import type { Meta, StoryObj } from '@storybook/react-vite';
import { TypeCheck } from './typecheck';

const meta = {
	title: 'Result Docs/TypeCheck',
	component: TypeCheck,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof TypeCheck>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * All type checks passed with no errors or warnings.
 */
export const AllPassing: Story = {
	args: {
		success: true,
		errors: [],
		warnings: [],
	},
};

/**
 * Single type error in one file.
 */
export const SingleError: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/components/Button.tsx',
				line: 23,
				column: 15,
				message: "Property 'variant' does not exist on type 'ButtonProps'.",
				code: 2339,
			},
		],
		warnings: [],
	},
};

/**
 * Multiple type errors in different files.
 */
export const MultipleErrors: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/components/Button.tsx',
				line: 23,
				column: 15,
				message: "Property 'variant' does not exist on type 'ButtonProps'.",
				code: 2339,
			},
			{
				file: 'src/components/Button.tsx',
				line: 45,
				column: 7,
				message: "Type 'string' is not assignable to type 'number'.",
				code: 2322,
			},
			{
				file: 'src/components/Input.tsx',
				line: 12,
				column: 3,
				message: "Cannot find name 'onChange'. Did you mean 'onchange'?",
				code: 2552,
			},
			{
				file: 'src/utils/helpers.ts',
				line: 8,
				column: 10,
				message: "Parameter 'value' implicitly has an 'any' type.",
				code: 7006,
			},
			{
				file: 'src/hooks/useForm.ts',
				line: 34,
				column: 5,
				message: "Argument of type 'null' is not assignable to parameter of type 'string'.",
				code: 2345,
			},
		],
		warnings: [],
	},
};

/**
 * Warnings only (TypeScript --strict mode warnings).
 */
export const WarningsOnly: Story = {
	args: {
		success: true,
		errors: [],
		warnings: [
			{
				file: 'src/components/Card.tsx',
				line: 18,
				column: 9,
				message: "'title' is declared but its value is never read.",
				code: 6133,
			},
			{
				file: 'src/utils/format.ts',
				line: 5,
				column: 14,
				message: "'formatDate' is declared but its value is never read.",
				code: 6133,
			},
		],
	},
};

/**
 * Mix of errors and warnings.
 */
export const ErrorsAndWarnings: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/components/Form.tsx',
				line: 56,
				column: 12,
				message: "Type 'undefined' is not assignable to type 'string'.",
				code: 2322,
			},
			{
				file: 'src/components/Form.tsx',
				line: 78,
				column: 5,
				message: "Property 'onSubmit' is missing in type '{}' but required in type 'FormProps'.",
				code: 2741,
			},
		],
		warnings: [
			{
				file: 'src/components/Form.tsx',
				line: 23,
				column: 7,
				message: "'initialValue' is declared but its value is never read.",
				code: 6133,
			},
		],
	},
};

/**
 * Common React hook dependency error.
 */
export const HookDependencyError: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/hooks/useData.ts',
				line: 15,
				column: 6,
				message:
					"React Hook useEffect has a missing dependency: 'fetchData'. Either include it or remove the dependency array.",
				code: 6133,
			},
		],
		warnings: [],
	},
};

/**
 * Strict null checks error.
 */
export const StrictNullCheckError: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/components/UserProfile.tsx',
				line: 28,
				column: 18,
				message: "Object is possibly 'null'.",
				code: 2531,
			},
			{
				file: 'src/components/UserProfile.tsx',
				line: 32,
				column: 5,
				message: "Object is possibly 'undefined'.",
				code: 2532,
			},
		],
		warnings: [],
	},
};

/**
 * Module resolution errors.
 */
export const ModuleResolutionErrors: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/App.tsx',
				line: 3,
				column: 23,
				message: "Cannot find module './components/Header' or its corresponding type declarations.",
				code: 2769,
			},
			{
				file: 'src/pages/Dashboard.tsx',
				line: 1,
				column: 28,
				message: "Cannot find module 'react-router-dom' or its corresponding type declarations.",
				code: 2769,
			},
		],
		warnings: [],
	},
};

/**
 * Generic type errors.
 */
export const GenericTypeErrors: Story = {
	args: {
		success: false,
		errors: [
			{
				file: 'src/api/client.ts',
				line: 42,
				column: 10,
				message: "Type 'Promise<any>' is not assignable to type 'Promise<Response<T>>'.",
				code: 2322,
			},
			{
				file: 'src/api/client.ts',
				line: 58,
				column: 7,
				message: "Generic type 'Map<K, V>' requires 2 type argument(s).",
				code: 2707,
			},
		],
		warnings: [],
	},
};

/**
 * Large number of errors from a single file.
 */
export const ManyErrorsInOneFile: Story = {
	args: {
		success: false,
		errors: Array.from({ length: 15 }, (_, i) => ({
			file: 'src/legacy/OldComponent.tsx',
			line: (i + 1) * 10,
			column: 5 + i,
			message: `Type error ${i + 1}: Various type mismatches and missing properties.`,
			code: 2322 + (i % 5),
		})),
		warnings: [],
	},
};
