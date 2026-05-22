import { describe, expect, it } from 'vitest';
import { getInterceptMarkdown, intercept, META_INTERCEPT_REASON } from './intercepts.ts';
import type { StorybookInstanceRecordV1 } from '../types/index.ts';

const record = (overrides: Partial<StorybookInstanceRecordV1> = {}): StorybookInstanceRecordV1 => ({
	schemaVersion: 1,
	instanceId: 'a',
	pid: 1,
	cwd: '/a',
	url: 'http://localhost:6006',
	port: 6006,
	mcp: { status: 'ready', endpoint: 'http://localhost:6006/mcp' },
	...overrides,
});

describe('intercepts', () => {
	it.each([
		['no-instance', 'No Storybook is running'],
		['addon-missing', '@storybook/addon-mcp'],
		['mcp-starting', 'starting up'],
		['mcp-error', 'reported an error'],
		['invalid-cwd', 'absolute path'],
	] as const)('%s contains an actionable hint', (reason, needle) => {
		expect(getInterceptMarkdown(reason)).toContain(needle);
	});

	it('no-instance lists running candidates when any are provided', () => {
		const md = getInterceptMarkdown('no-instance', {
			requestedCwd: '/wherever',
			records: [record()],
		});
		expect(md).toContain('Running Storybooks');
		expect(md).toContain('/a');
		expect(md).toContain('http://localhost:6006');
	});

	it('no-instance lists workspace packages with install status when supplied', () => {
		const md = getInterceptMarkdown('no-instance', {
			requestedCwd: '/repo',
			workspaces: [
				{
					packagePath: '/repo/packages/ui',
					name: '@app/ui',
					hasStorybook: true,
					hasAddonMcp: true,
				},
				{
					packagePath: '/repo/packages/api',
					name: '@app/api',
					hasStorybook: true,
					hasAddonMcp: false,
				},
				{
					packagePath: '/repo/apps/web',
					name: '@app/web',
					hasStorybook: false,
					hasAddonMcp: false,
				},
			],
		});
		expect(md).toContain('Workspace packages in this monorepo');
		expect(md).toContain('@app/ui');
		expect(md).toContain('@app/api');
		expect(md).toContain('@app/web');
		expect(md).toContain('npx storybook add @storybook/addon-mcp');
		expect(md).toContain('/repo/packages/ui');
	});

	it('no-instance pivots wording when no workspace package has Storybook installed', () => {
		const md = getInterceptMarkdown('no-instance', {
			requestedCwd: '/repo',
			workspaces: [
				{
					packagePath: '/repo/packages/a',
					name: '@app/a',
					hasStorybook: false,
					hasAddonMcp: false,
				},
				{
					packagePath: '/repo/packages/b',
					name: '@app/b',
					hasStorybook: false,
					hasAddonMcp: false,
				},
			],
		});
		expect(md).toContain('No package in this monorepo has Storybook installed');
		expect(md).toContain('Ask the user which package');
		expect(md).toContain('npx storybook init');
	});

	it('no-instance tells the agent to ask the user when Storybook is installed in multiple packages', () => {
		const md = getInterceptMarkdown('no-instance', {
			requestedCwd: '/repo',
			workspaces: [
				{
					packagePath: '/repo/packages/a',
					name: '@app/a',
					hasStorybook: true,
					hasAddonMcp: true,
				},
				{
					packagePath: '/repo/packages/b',
					name: '@app/b',
					hasStorybook: true,
					hasAddonMcp: true,
				},
			],
		});
		expect(md).toContain('ask them before starting');
	});

	it('multiple-matches lists conflicting pids', () => {
		const md = getInterceptMarkdown('multiple-matches', {
			records: [
				record({ instanceId: 'a', pid: 111, cwd: '/same', url: 'http://localhost:6006', port: 6006 }),
				record({ instanceId: 'b', pid: 222, cwd: '/same', url: 'http://localhost:6007', port: 6007 }),
			],
		});
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
