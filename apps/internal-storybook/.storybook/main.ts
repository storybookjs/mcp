import { defineMain } from '@storybook/react-vite/node';

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
			options: {
				// toolsets: {
				// 	dev: false,
				// 	docs: false,
				// },
			},
		},
	],
	framework: '@storybook/react-vite',
	// logLevel: 'debug',
	core: {
		disableTelemetry: true,
	},
	features: {
		experimentalComponentsManifest: true,
	},
	// Test composition with private Chromatic Storybook
	refs: {
		'storybook-next': {
			title: 'Storybook Next',
			url: 'https://next--635781f3500dd2c49e189caf.chromatic.com',
		},
	},
});

export default config;
