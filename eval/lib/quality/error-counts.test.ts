import { describe, it, expect } from 'vitest';
import type { TrialArgs, ExecutionSummary, GradingSummary } from '../../types.ts';
import {
	fromTypeCheckErrors,
	fromLintErrors,
	fromA11yViolations,
	fromTestPassRate,
} from './error-counts.ts';

function createGrading(overrides: Partial<GradingSummary> = {}): GradingSummary {
	return {
		buildSuccess: true,
		typeCheckErrors: 0,
		lintErrors: 0,
		test: { passed: 0, failed: 0 },
		a11y: { violations: 0 },
		...overrides,
	};
}

function calculateTypeCheck(errors: number) {
	return fromTypeCheckErrors({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: createGrading({ typeCheckErrors: errors }),
	})!;
}

function calculateLint(errors: number) {
	return fromLintErrors({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: createGrading({ lintErrors: errors }),
	})!;
}

function calculateA11y(violations: number) {
	return fromA11yViolations({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: createGrading({ a11y: { violations } }),
	})!;
}

function calculateTestPassRate(passed: number, failed: number) {
	return fromTestPassRate({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: createGrading({ test: { passed, failed } }),
	})!;
}

describe('fromTypeCheckErrors', () => {
	describe('score calculation', () => {
		it('returns 1.0 for 0 errors', () => {
			expect(calculateTypeCheck(0).score).toBe(1.0);
		});

		it('returns 0.9 for 1 error', () => {
			expect(calculateTypeCheck(1).score).toBe(0.9);
		});

		it('returns 0.5 for 5 errors', () => {
			expect(calculateTypeCheck(5).score).toBe(0.5);
		});

		it('returns 0.0 for 10 errors', () => {
			expect(calculateTypeCheck(10).score).toBe(0.0);
		});

		it('returns 0.0 for more than 10 errors', () => {
			expect(calculateTypeCheck(15).score).toBe(0.0);
			expect(calculateTypeCheck(100).score).toBe(0.0);
		});
	});
});

describe('fromLintErrors', () => {
	describe('score calculation', () => {
		it('returns 1.0 for 0 errors', () => {
			expect(calculateLint(0).score).toBe(1.0);
		});

		it('returns 0.9 for 1 error', () => {
			expect(calculateLint(1).score).toBe(0.9);
		});

		it('returns 0.5 for 5 errors', () => {
			expect(calculateLint(5).score).toBe(0.5);
		});

		it('returns 0.0 for 10 errors', () => {
			expect(calculateLint(10).score).toBe(0.0);
		});

		it('returns 0.0 for more than 10 errors', () => {
			expect(calculateLint(15).score).toBe(0.0);
			expect(calculateLint(100).score).toBe(0.0);
		});
	});
});

describe('fromA11yViolations', () => {
	describe('score calculation', () => {
		it('returns 1.0 for 0 violations', () => {
			expect(calculateA11y(0).score).toBe(1.0);
		});

		it('returns 0.8 for 1 violation', () => {
			expect(calculateA11y(1).score).toBe(0.8);
		});

		it('returns 0.6 for 2 violations', () => {
			expect(calculateA11y(2).score).toBe(0.6);
		});

		it('returns 0.0 for 5 violations', () => {
			expect(calculateA11y(5).score).toBe(0.0);
		});

		it('returns 0.0 for more than 5 violations', () => {
			expect(calculateA11y(7).score).toBe(0.0);
			expect(calculateA11y(50).score).toBe(0.0);
		});
	});
});

describe('fromTestPassRate', () => {
	describe('score calculation', () => {
		it('returns 0.0 when no tests were run', () => {
			expect(calculateTestPassRate(0, 0).score).toBe(0.0);
		});

		it('returns 1.0 when all tests pass', () => {
			expect(calculateTestPassRate(5, 0).score).toBe(1.0);
		});

		it('returns 0.75 for 75% pass rate', () => {
			expect(calculateTestPassRate(3, 1).score).toBe(0.75);
		});

		it('returns 0.5 for 50% pass rate', () => {
			expect(calculateTestPassRate(2, 2).score).toBe(0.5);
		});

		it('returns 0.0 when all tests fail', () => {
			expect(calculateTestPassRate(0, 4).score).toBe(0.0);
		});
	});
});
