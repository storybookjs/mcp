import type { Context } from '../types.ts';

export function isDevEvaluation(context: Context): boolean {
	return context.type === 'storybook-mcp-dev';
}
