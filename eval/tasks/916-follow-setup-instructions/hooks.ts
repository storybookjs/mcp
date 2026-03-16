import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Hooks } from '../../types.ts';
import { combine, fromMcpToolsCoverage, fromTestPassRate } from '../../lib/quality/index.ts';

const hooks: Hooks = {
	postPrepareTrial: async (trialArgs) => {
		await fs.cp(
			path.join(trialArgs.taskPath, 'seed', '@acme', 'ui'),
			path.join(trialArgs.projectPath, 'node_modules', '@acme', 'ui'),
			{ recursive: true },
		);
	},
	calculateQuality: combine([fromMcpToolsCoverage, 0.5], [fromTestPassRate, 0.5]),
};

export default hooks;
