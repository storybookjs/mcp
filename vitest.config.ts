import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tsconfigPaths(),
		{
			name: 'md-loader',
			transform(code: string, id: string) {
				if (id.endsWith('.md')) {
					return { code: `export default ${JSON.stringify(code)};`, map: null };
				}
			},
		},
	],
	test: {
		projects: ['packages/*', 'apps/*'],
		coverage: {
			include: ['**/src/**/*.{ts,tsx}'],
			exclude: ['*.d.ts'],
			reporter: ['text', 'lcov', 'html'],
		},
	},
});
