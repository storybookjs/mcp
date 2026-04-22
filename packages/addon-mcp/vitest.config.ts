import { fileURLToPath } from 'node:url';

import { mergeConfig } from 'vite';

import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import vitestConfig from '../../vitest.config.ts';

const packageRoot = fileURLToPath(new URL('./', import.meta.url));
const { test: sharedTest, ...sharedConfig } = vitestConfig as any;

export default mergeConfig(
	sharedConfig,
	defineConfig({
		root: packageRoot,
		test: {
			...sharedTest,
			projects: [
				{
					extends: true,
					test: {
						name: '@storybook/addon-mcp',
						setupFiles: ['./vitest.setup.ts'],
						include: ['src/**/*.test.ts'],
						exclude: ['src/**/*.browser.test.ts'],
					},
				},
				{
					extends: true,
					test: {
						name: '@storybook/addon-mcp-browser',
						setupFiles: ['./vitest.setup.ts'],
						include: ['src/**/*.browser.test.ts'],
						browser: {
							enabled: true,
							headless: true,
							provider: playwright({}),
							instances: [{ browser: 'chromium' }],
						},
					},
				},
			],
		},
	}),
);
