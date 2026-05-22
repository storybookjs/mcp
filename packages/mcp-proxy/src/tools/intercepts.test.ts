import { describe, expect, it } from 'vitest';
import { getInterceptMarkdown, intercept, isClaudeClient, META_INTERCEPT_REASON } from './intercepts.ts';

describe('intercepts', () => {
	it.each([
		['no-instance', 'Storybook is not running'],
		['addon-missing', '@storybook/addon-mcp'],
		['mcp-starting', 'starting up'],
		['mcp-error', 'reported an error'],
		['invalid-cwd', 'absolute path'],
	] as const)('%s contains an actionable hint', (reason, needle) => {
		expect(getInterceptMarkdown(reason)).toContain(needle);
	});

	it('no-instance omits Claude launch repair guidance for generic clients', () => {
		const md = getInterceptMarkdown('no-instance');
		expect(md).toContain('Storybook is not running');
		expect(md).not.toContain('/storybook-setup-claude-launch');
		expect(md).not.toContain('Claude launcher');
	});

	it('no-instance includes Claude launch repair guidance for Claude clients', () => {
		const md = getInterceptMarkdown('no-instance', undefined, {
			clientInfo: { name: 'claude-code', version: '2.1.145' },
		});
		expect(md).toContain('/storybook-setup-claude-launch');
		expect(md).toContain('.claude/launch.json');
		expect(md).toContain('do not start Storybook as an ad hoc Bash/background task');
		expect(md).toContain('Claude launcher');
		expect(md).toContain('exact same cwd');
	});

	it('no-instance lists running candidates when any are provided', () => {
		const records = [
			{
				schemaVersion: 1 as const,
				instanceId: 'a',
				pid: 1,
				cwd: '/a',
				url: 'http://localhost:6006',
				port: 6006,
				mcp: { status: 'ready' as const, endpoint: 'http://localhost:6006/mcp' },
			},
		];
		const md = getInterceptMarkdown('no-instance', records);
		expect(md).toContain('Running Storybooks');
		expect(md).toContain('/a');
		expect(md).toContain('http://localhost:6006');
		expect(md).not.toContain('/storybook-setup-claude-launch');
		expect(md).not.toContain('Claude launcher');

		const claudeMd = getInterceptMarkdown('no-instance', records, {
			clientInfo: { name: 'Claude Code', version: '2.1.145' },
		});
		expect(claudeMd).toContain('/storybook-setup-claude-launch');
		expect(claudeMd).toContain('Claude launcher');
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

	it('detects Claude from MCP client metadata', () => {
		expect(isClaudeClient({ name: 'claude-code' })).toBe(true);
		expect(isClaudeClient({ title: 'Claude Code' })).toBe(true);
		expect(isClaudeClient({ name: 'test-client' })).toBe(false);
		expect(isClaudeClient(undefined)).toBe(false);
	});
});
