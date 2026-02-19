/**
 * Quality calculators based on error/violation counts.
 *
 * All use linear progression from 1.0 (no errors) to 0.0 (at threshold).
 * Formula: max(0, 1 - count / threshold)
 */

import type { CalculateQualityFn } from '../../types.ts';

/**
 * Quality calculator based on TypeScript type check errors.
 * 0 errors = 1.0, 10+ errors = 0.0, linear progression.
 */
export const fromTypeCheckErrors: CalculateQualityFn = ({ grading }) => {
	const errors = grading.typeCheckErrors;
	const score = Math.max(0, 1 - errors / 10);

	return {
		score,
		description: 'Type Check Errors',
	};
};

/**
 * Quality calculator based on ESLint errors.
 * 0 errors = 1.0, 10+ errors = 0.0, linear progression.
 */
export const fromLintErrors: CalculateQualityFn = ({ grading }) => {
	const errors = grading.lintErrors;
	const score = Math.max(0, 1 - errors / 10);

	return {
		score,
		description: 'Lint Errors',
	};
};

/**
 * Quality calculator based on accessibility violations.
 * 0 violations = 1.0, 5+ violations = 0.0, linear progression.
 */
export const fromA11yViolations: CalculateQualityFn = ({ grading }) => {
	const violations = grading.a11y.violations;
	const score = Math.max(0, 1 - violations / 5);

	return {
		score,
		description: 'A11y Violations',
	};
};

/**
 * Quality calculator based on the percentage of tests passed.
 *
 * Formula: passed / (passed + failed)
 * - 100% pass rate => 1.0
 * - 50% pass rate => 0.5
 * - 0% pass rate => 0.0
 * - 0 total tests => 0.0
 */
export const fromTestPassRate: CalculateQualityFn = ({ grading }) => {
	const passed = grading.test.passed;
	const failed = grading.test.failed;
	const total = passed + failed;
	const score = total > 0 ? passed / total : 0;

	return {
		score,
		description: 'Test Pass Rate',
	};
};
