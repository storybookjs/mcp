import type { Hooks } from '../../types.ts';
import { combine, fromMcpToolsCoverage, fromTestPassRate } from '../../lib/quality/index.ts';

const hooks: Hooks = {
	calculateQuality: combine([fromMcpToolsCoverage, 0.5], [fromTestPassRate, 0.5]),
};

export default hooks;
