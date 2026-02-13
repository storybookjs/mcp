import type { Hooks } from '../../types.ts';
import {
	combine,
	fromA11yViolations,
	fromMcpToolsCoverage,
	fromTestPassRate,
} from '../../lib/quality/index.ts';

const hooks: Hooks = {
	calculateQuality: combine(
		[fromMcpToolsCoverage, 0.4],
		[fromTestPassRate, 0.4],
		[fromA11yViolations, 0.2],
	),
};

export default hooks;
