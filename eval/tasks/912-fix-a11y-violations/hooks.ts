import type { Hooks } from '../../types.ts';
import {
	combine,
	fromJudgeScore,
	fromMcpToolsCoverage,
	fromTestPassRate,
} from '../../lib/quality/index.ts';

const hooks: Hooks = {
	calculateQuality: combine(
		[fromMcpToolsCoverage, 0.1],
		[fromTestPassRate, 0.35],
		[fromJudgeScore, 0.55],
	),
};

export default hooks;
