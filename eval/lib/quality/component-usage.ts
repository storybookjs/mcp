/**
 * Quality calculator based on component usage matching.
 *
 * Formula: matched / (matched + missing + unexpected)
 * Returns 1.0 when all expected components are used and no unexpected ones.
 * Returns undefined if no component usage data is available.
 */

import type { CalculateQualityFn, QualityResult } from '../../types.ts';

export const fromComponentUsage: CalculateQualityFn = ({ grading }): QualityResult | undefined => {
	const cu = grading.componentUsage;
	if (!cu) {
		return undefined;
	}

	const total = cu.matched + cu.missing + cu.unexpected;
	if (total === 0) {
		return undefined;
	}

	// matched / total gives 1.0 when perfect match
	const score = cu.matched / total;

	return {
		score,
		description: 'Component Usage',
	};
};
