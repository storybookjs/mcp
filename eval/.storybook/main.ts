import type { StorybookConfig } from '@storybook/react-vite';

import { dirname } from 'path';

import { fileURLToPath } from 'url';

/**
 * This function is used to resolve the absolute path of a package.
 * It is needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string): any {
	return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
	stories: [
		'../evals/*/experiments/*/project/stories/*.stories.@(js|jsx|mjs|ts|tsx)',
		'../templates/result-docs/*.stories.@(js|jsx|mjs|ts|tsx)',
	],
	addons: [
		getAbsolutePath('@storybook/addon-a11y'),
		getAbsolutePath('storybook-addon-test-codegen'),
	],
	framework: {
		name: getAbsolutePath('@storybook/react-vite'),
		options: {},
	},
	core: {
		builder: {
			name: getAbsolutePath("@storybook/builder-vite"),
			options: {
				viteConfigPath: './templates/project/vite.config.ts',
			},
		},
	},
};
export default config;
