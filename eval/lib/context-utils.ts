import type { Context } from '../types.ts';

export function isDevContext(context: Context): boolean {
	return context.some((ctx) => ctx.type === 'storybook-mcp-dev');
}

export function isDocsContext(context: Context): boolean {
	return context.some((ctx) => ctx.type === 'storybook-mcp-docs');
}
