import type { Context } from '../types.ts';

export function isDevEvaluation(context: Context): boolean {
	return context.some((ctx) => ctx.type === 'storybook-mcp-dev');
}
