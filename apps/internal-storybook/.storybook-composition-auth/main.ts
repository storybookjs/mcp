import { defineMain } from '@storybook/react-vite/node';

/**
 * Multi-source Storybook configuration with a private Chromatic ref.
 * Used for manual testing of the OAuth composition auth flow.
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
	refs: {
		'test-private-sb': {
			title: 'Test Private SB',
			url: 'https://main--6985a38660050ca8a9e62053.chromatic.com',
		},
	},
});

export default config;
