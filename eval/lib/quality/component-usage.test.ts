import { describe, it, expect } from 'vitest';
import type { TrialArgs, ExecutionSummary } from '../../types.ts';
import { fromComponentUsage } from './component-usage.ts';

function calculate(componentUsage?: {
	score: number;
	matched: number;
	missing: number;
	unexpected: number;
}) {
	return fromComponentUsage({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: {
			buildSuccess: true,
			typeCheckErrors: 0,
			lintErrors: 0,
			test: { passed: 0, failed: 0 },
			a11y: { violations: 0 },
			componentUsage,
		},
	});
}

describe('fromComponentUsage', () => {
	describe('edge cases', () => {
		it('returns undefined when no component usage data', () => {
			expect(calculate(undefined)).toBeUndefined();
		});

		it('returns undefined when all counts are zero', () => {
			expect(calculate({ score: 0, matched: 0, missing: 0, unexpected: 0 })).toBeUndefined();
		});
	});

	describe('perfect matches', () => {
		it('returns 1.0 when all expected components matched with no issues', () => {
			const result = calculate({ score: 1, matched: 5, missing: 0, unexpected: 0 });
			expect(result?.score).toBe(1.0);
		});

		it('returns 1.0 with single matched component', () => {
			const result = calculate({ score: 1, matched: 1, missing: 0, unexpected: 0 });
			expect(result?.score).toBe(1.0);
		});
	});

	describe('missing components', () => {
		it('returns 0.5 when half components missing', () => {
			const result = calculate({ score: 0.5, matched: 2, missing: 2, unexpected: 0 });
			expect(result?.score).toBe(0.5);
		});

		it('returns 0 when all components missing', () => {
			const result = calculate({ score: 0, matched: 0, missing: 3, unexpected: 0 });
			expect(result?.score).toBe(0);
		});

		it('returns 0.75 when 3/4 matched', () => {
			const result = calculate({ score: 0.75, matched: 3, missing: 1, unexpected: 0 });
			expect(result?.score).toBe(0.75);
		});
	});

	describe('unexpected components', () => {
		it('returns 0.5 when matched equals unexpected', () => {
			const result = calculate({ score: 0.5, matched: 2, missing: 0, unexpected: 2 });
			expect(result?.score).toBe(0.5);
		});

		it('returns 0 when only unexpected components', () => {
			const result = calculate({ score: 0, matched: 0, missing: 0, unexpected: 3 });
			expect(result?.score).toBe(0);
		});

		it('returns 0.8 when 4 matched and 1 unexpected', () => {
			const result = calculate({ score: 0.8, matched: 4, missing: 0, unexpected: 1 });
			expect(result?.score).toBe(0.8);
		});
	});

	describe('combined scenarios', () => {
		it('calculates correctly with all three factors', () => {
			const result = calculate({ score: 0.6, matched: 3, missing: 1, unexpected: 1 });
			expect(result?.score).toBe(0.6);
		});

		it('handles large numbers proportionally', () => {
			const result = calculate({ score: 0.5, matched: 50, missing: 25, unexpected: 25 });
			expect(result?.score).toBe(0.5);
		});

		it('penalizes equally for missing and unexpected', () => {
			const resultMissing = calculate({ score: 0.75, matched: 3, missing: 1, unexpected: 0 });
			const resultUnexpected = calculate({ score: 0.75, matched: 3, missing: 0, unexpected: 1 });
			expect(resultMissing?.score).toBe(resultUnexpected?.score);
		});
	});

	describe('description', () => {
		it('returns correct description', () => {
			const result = calculate({ score: 1, matched: 1, missing: 0, unexpected: 0 });
			expect(result?.description).toBe('Component Usage');
		});
	});
});
