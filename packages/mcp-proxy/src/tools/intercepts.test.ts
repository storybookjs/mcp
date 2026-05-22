import { describe, expect, it } from 'vitest';
import { getInterceptMarkdown, intercept, META_INTERCEPT_REASON } from './intercepts.ts';

describe('intercepts', () => {
	it.each([
		['no-instance', 'Storybook is not running'],
		['addon-missing', '@storybook/addon-mcp'],
		['mcp-starting', 'starting up'],
		['mcp-error', 'reported an error'],
		['invalid-cwd', 'absolute path'],
		['storybook-needs-upgrade', 'too old'],
	] as const)('%s contains an actionable hint', (reason, needle) => {
		expect(getInterceptMarkdown(reason)).toContain(needle);
	});

	it('no-instance lists running candidates when any are provided', () => {
		const md = getInterceptMarkdown('no-instance', [
			{
				schemaVersion: 1,
				instanceId: 'a',
				pid: 1,
				cwd: '/a',
				url: 'http://localhost:6006',
				port: 6006,
				mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
			},
		]);
		expect(md).toContain('Running Storybooks');
		expect(md).toContain('/a');
		expect(md).toContain('http://localhost:6006');
	});

	it('storybook-needs-upgrade surfaces the detected version and tells the agent to upgrade first', () => {
		const md = getInterceptMarkdown('storybook-needs-upgrade', [
			{
				schemaVersion: 1,
				instanceId: 'a',
				pid: 1,
				cwd: '/p',
				url: 'http://localhost:6006',
				port: 6006,
				storybookVersion: '8.6.0',
				mcp: { status: 'not-installed' },
			},
		]);
		expect(md).toContain('too old');
		expect(md).toContain('Ask the user to upgrade Storybook');
		expect(md).toContain('8.6.0');
		expect(md).toContain('9.1.16');
		expect(md).toContain('npx storybook upgrade');
		expect(md).toContain('npx storybook add @storybook/addon-mcp');
		expect(md).toContain('storybook:storybook-upgrade');
	});

	it('multiple-matches lists conflicting pids', () => {
		const md = getInterceptMarkdown('multiple-matches', [
			{
				schemaVersion: 1,
				instanceId: 'a',
				pid: 111,
				cwd: '/same',
				url: 'http://localhost:6006',
				port: 6006,
				mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
			},
			{
				schemaVersion: 1,
				instanceId: 'b',
				pid: 222,
				cwd: '/same',
				url: 'http://localhost:6007',
				port: 6007,
				mcp: { status: 'ready', endpoint: 'http://localhost:6007/mcp' },
			},
		]);
		expect(md).toContain('111');
		expect(md).toContain('222');
		expect(md).toContain('/same');
	});

	it('intercept() returns a tool result with isError and namespaced reason metadata', () => {
		const result = intercept('no-instance');
		expect(result.isError).toBe(true);
		expect(result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(META_INTERCEPT_REASON).toBe('storybook.dev/interceptReason');
		expect(result.content[0]?.type).toBe('text');
	});
});
