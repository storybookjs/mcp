/**
 * Quality calculators based on error/violation counts.
 *
 * All use linear progression from 1.0 (no errors) to 0.0 (at threshold).
 * Formula: max(0, 1 - count / threshold)
 */

import type { CalculateQualityFn, QualityResult } from '../../types.ts';

/**
 * Quality calculator based on TypeScript type check errors.
 * 0 errors = 1.0, 10+ errors = 0.0, linear progression.
 */
export const fromTypeCheckErrors: CalculateQualityFn = ({ grading }): QualityResult => {
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
export const fromLintErrors: CalculateQualityFn = ({ grading }): QualityResult => {
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
export const fromA11yViolations: CalculateQualityFn = ({ grading }): QualityResult => {
	const violations = grading.a11y.violations;
	const score = Math.max(0, 1 - violations / 5);

	return {
		score,
		description: 'A11y Violations',
	};
};
