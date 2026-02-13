import type { QualityArgs, QualityResult } from '../../types.ts';

export function fromJudgeScore({ grading }: QualityArgs): QualityResult | undefined {
	if (!grading.judge) return undefined;

	return {
		score: grading.judge.score,
		description: 'LLM-as-a-Judge',
	};
}
