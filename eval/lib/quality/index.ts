/**
 * Shared quality calculators for eval trials.
 *
 * Quality is a normalized score from 0 to 1 representing how well
 * the agent performed on a task. These calculators can be used
 * directly or combined with weights.
 */

import type {
	CalculateQualityFn,
	QualityArgs,
	QualityResult,
} from '../../types.ts';

export { fromComponentUsage } from './component-usage.ts';
export { fromMcpToolsCoverage } from './mcp-tools-coverage.ts';

/**
 * Combine multiple quality calculators with weights.
 * Returns a weighted average score and concatenates descriptions.
 * Skips any calculators that return undefined.
 *
 * @example
 * ```ts
 * import { combine, fromComponentUsage, fromMcpToolsCoverage } from '../lib/quality/index.ts';
 *
 * const hooks: Hooks = {
 *   calculateQuality: combine(
 *     [fromComponentUsage, 0.6],
 *     [fromMcpToolsCoverage, 0.4]
 *   ),
 * };
 * ```
 */
export function combine(
	...calculators: Array<[CalculateQualityFn, number]>
): CalculateQualityFn {
	return (args: QualityArgs): QualityResult | undefined => {
		let totalWeight = 0;
		let weightedSum = 0;
		const descriptions: string[] = [];

		for (const [calculator, weight] of calculators) {
			const result = calculator(args);
			if (result !== undefined) {
				totalWeight += weight;
				weightedSum += result.score * weight;
				descriptions.push(result.description);
			}
		}

		if (totalWeight === 0) {
			return undefined;
		}

		// Normalize by total weight (handles cases where some calculators return undefined)
		const score = Math.max(0, Math.min(1, weightedSum / totalWeight));

		return {
			score,
			description: descriptions.join(', '),
		};
	};
}
