/**
 * Quality calculator based on MCP tools expectations coverage.
 *
 * Calculates a granular score based on:
 * - Whether expected tools were called (40% base weight)
 * - Whether expected call inputs were matched (40% base weight)
 * - Whether output tokens stayed within limits (20% base weight)
 *
 * Note: Weights are relative to configured aspects only. When some validation
 * aspects are not configured (e.g., no input matching expectations), the score
 * is normalized by the sum of active weights. For example, if only tool presence
 * and token limits are configured, they effectively become 66.7% and 33.3%.
 *
 * Returns undefined if no MCP tools were used or no expectations configured.
 */

import type { CalculateQualityFn, QualityResult } from '../../types.ts';

const DESCRIPTION = 'MCP Tools';

export const fromMcpToolsCoverage: CalculateQualityFn = ({
	grading,
}): QualityResult | undefined => {
	const mcp = grading.mcpTools;
	if (!mcp || mcp.tools.length === 0) {
		return undefined;
	}

	// Count tools with validation (expectations configured)
	const toolsWithValidation = mcp.tools.filter((t) => t.validation);
	if (toolsWithValidation.length === 0) {
		// No expectations configured - just report tool usage
		return {
			score: 1.0,
			description: DESCRIPTION,
		};
	}

	// Calculate scores for each aspect
	let inputMatchScore = 0;
	let inputMatchTotal = 0;
	let tokenLimitScore = 0;
	let tokenLimitTotal = 0;

	for (const tool of toolsWithValidation) {
		const validation = tool.validation!;

		// Input matching
		if (validation.inputMatch !== undefined) {
			inputMatchTotal++;
			if (validation.inputMatch) {
				inputMatchScore++;
			}
		}

		// Token limits
		if (validation.outputTokensWithinLimit !== undefined) {
			tokenLimitTotal++;
			if (validation.outputTokensWithinLimit) {
				tokenLimitScore++;
			}
		}
	}

	// Calculate weighted score
	// Tool presence (all tools with expectations exist): 40%
	// Input matching: 40%
	// Token limits: 20%
	let totalWeight = 0;
	let weightedScore = 0;

	// Tool presence: What percentage of expected tools were called
	const toolPresenceScore =
		mcp.expectedToolCount && mcp.calledExpectedToolCount !== undefined
			? mcp.calledExpectedToolCount / mcp.expectedToolCount
			: 1.0;
	totalWeight += 0.4;
	weightedScore += toolPresenceScore * 0.4;

	if (inputMatchTotal > 0) {
		const inputRatio = inputMatchScore / inputMatchTotal;
		totalWeight += 0.4;
		weightedScore += inputRatio * 0.4;
	}

	if (tokenLimitTotal > 0) {
		const tokenRatio = tokenLimitScore / tokenLimitTotal;
		totalWeight += 0.2;
		weightedScore += tokenRatio * 0.2;
	}

	const score = totalWeight > 0 ? weightedScore / totalWeight : 1.0;

	return {
		score,
		description: DESCRIPTION,
	};
};
