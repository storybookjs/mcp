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
		'design-system': {
			title: 'Design System',
			url: 'https://62e7a15f87b0f4a7bed2cf04-ejukkgyspq.chromatic.com',
		},
	},
});

export default config;
