import type { Hooks } from '../../types.ts';
import { fromMcpToolsCoverage } from '../../lib/quality/index.ts';

const hooks: Hooks = {
	calculateQuality: fromMcpToolsCoverage,
};

export default hooks;
