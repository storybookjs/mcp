import { defineMain } from '@storybook/react-vite/node';

/**
 * Multi-source Storybook configuration with composition (refs).
 * Used for E2E tests that verify multi-source/composition behavior.
 */
const config = defineMain({
	stories: [
		'../stories/**/*.mdx',
		'../stories/components/**/*.stories.@(js|jsx|ts|tsx)',
		{
			titlePrefix: 'Other UI',
			directory: '../stories/other',
			files: '**/*.stories.@(js|jsx|ts|tsx)',
		},
	],
	addons: [
		'@storybook/addon-docs',
		'@storybook/addon-themes',
		{
			name: '@storybook/addon-mcp',
			options: {},
		},
	],
	framework: '@storybook/react-vite',
	core: {
		disableTelemetry: true,
	},
	features: {
		experimentalComponentsManifest: true,
	},
	// Composition with public Chromatic Storybook (storybook-ui next branch)
	refs: {
		'storybook-ui': {
			title: 'Storybook UI',
			url: 'https://next--635781f3500dd2c49e189caf.chromatic.com',
		},
	},
});

export default config;
