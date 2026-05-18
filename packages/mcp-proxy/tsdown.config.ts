import { defineConfig } from 'tsdown';

import sharedTsDownConfig from '../../tsdown-shared.config.ts';
import pkg from './package.json' with { type: 'json' };

const sharedConfig = sharedTsDownConfig(pkg.name);

export default defineConfig({
	...sharedConfig,
	entry: {
		index: 'src/index.ts',
		bin: 'bin.ts',
	},
});
