import { describe, expect, it } from 'vitest';
import { getInterceptMarkdown, intercept, META_INTERCEPT_REASON } from './intercepts.ts';

describe('intercepts', () => {
	it.each([
		['no-instance', 'Storybook is not running'],
		['no-launch-config', 'No Storybook launch configuration'],
		['addon-missing', '@storybook/addon-mcp'],
		['storybook-outdated', 'upgrade'],
		['mcp-starting', 'starting up'],
	] as const)('%s contains an actionable hint', (reason, needle) => {
		expect(getInterceptMarkdown(reason)).toContain(needle);
	});

	it('storybook-outdated points at @latest', () => {
		expect(getInterceptMarkdown('storybook-outdated')).toContain('npx storybook@latest upgrade');
	});

	it('lists candidate cwds for multiple-matches', () => {
		const md = getInterceptMarkdown('multiple-matches', [
			{
				pid: 1,
				cwd: '/a',
				url: 'http://localhost:6006',
				mcp: { ready: true, path: '/mcp' },
			},
			{
				pid: 2,
				cwd: '/b',
				url: 'http://localhost:6007',
				mcp: { ready: true, path: '/mcp' },
			},
		]);
		expect(md).toContain('/a');
		expect(md).toContain('/b');
		expect(md).toContain('http://localhost:6006');
		expect(md).toContain('`cwd`');
	});

	it('intercept() returns a tool result with isError and namespaced reason metadata', () => {
		const result = intercept('no-instance');
		expect(result.isError).toBe(true);
		expect(result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(META_INTERCEPT_REASON).toBe('storybook.dev/interceptReason');
		expect(result.content[0]?.type).toBe('text');
	});
});
