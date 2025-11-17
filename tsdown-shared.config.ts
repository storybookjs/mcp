import { defineConfig } from 'tsdown';
import { codecovRollupPlugin } from '@codecov/rollup-plugin';

export default (pkgName: string) =>
	defineConfig({
		target: 'node20.19', // Minimum Node version supported by Storybook 10
		loader: {
			'.md': 'text',
			'.html': 'text',
		},
		plugins: [
			codecovRollupPlugin({
				enableBundleAnalysis: true,
				bundleName: pkgName,
				oidc: {
					useGitHubOIDC: true,
				},
				dryRun: process.env.CI !== 'true',
				debug: true,
			}),
		],
	}) as any;
