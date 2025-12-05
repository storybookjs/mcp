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
	stories: ['../stories/*.stories.@(js|jsx|mjs|ts|tsx)', '../results/*.mdx'],
	addons: [
		'@storybook/addon-a11y',
		'@storybook/addon-vitest',
		'@storybook/addon-docs',
		'@storybook/addon-mcp',
	],
	framework: '@storybook/react-vite',
};
export default config;
