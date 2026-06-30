import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				test: {
					name: 'storybook',
					setupFiles: ['.storybook/vitest.setup.ts'],
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
});
