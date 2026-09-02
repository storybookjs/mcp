import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	dts: true,
	fixedExtension: false,
	target: 'node20.19',
});
