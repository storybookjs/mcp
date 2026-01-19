import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
	stories: [
		'../@(stories|src)/*.stories.@(js|jsx|mjs|ts|tsx)',
		'../results/*.mdx',
	],
	addons: [
		getAbsolutePath("@storybook/addon-a11y"),
		getAbsolutePath("@storybook/addon-vitest"),
		getAbsolutePath("@storybook/addon-docs"),
		getAbsolutePath("@storybook/addon-mcp"),
	],
	framework: getAbsolutePath("@storybook/react-vite"),
};
export default config;

function getAbsolutePath(value: string): any {
    return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
