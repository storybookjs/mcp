import { describe, expect, it } from 'vitest';
import { getInterceptMarkdown, intercept, META_INTERCEPT_REASON } from './intercepts.ts';

describe('intercepts', () => {
	it.each([
		['no-instance', 'Storybook is not running'],
		['addon-missing', '@storybook/addon-mcp'],
		['mcp-starting', 'starting up'],
		['mcp-error', 'reported an error'],
		['invalid-cwd', 'absolute path'],
		['storybook-too-old', 'storybook-upgrade'],
	] as const)('%s contains an actionable hint', (reason, needle) => {
		expect(getInterceptMarkdown(reason)).toContain(needle);
	});

	it('no-instance stays client-agnostic and never names a client-specific repair skill', () => {
		const md = getInterceptMarkdown('no-instance');
		expect(md).toContain('Storybook is not running');
		expect(md).not.toContain('storybook-setup-claude-launch');
		expect(md).not.toContain('.claude/launch.json');
	});

	it('storybook-too-old reports the detected version, the required version, and points to the upgrade skill', () => {
		const md = getInterceptMarkdown('storybook-too-old', { version: '9.0.5' });
		expect(md).toMatchInlineSnapshot(`
			"The Storybook installed at this cwd is version \`9.0.5\`, but this plugin requires \`9.1.16\` or newer.

			Ask the user whether they want to upgrade Storybook. If they agree, invoke the \`storybook-upgrade\` skill to perform the upgrade, then run:
			\`\`\`
			npx storybook add @storybook/addon-mcp
			\`\`\`
			to install the MCP addon. After the upgrade, call the \`clear-storybook-version-cache\` tool with the same \`cwd\` so the proxy re-detects the new version. Restart Storybook, then retry the tool call."
		`);
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
		const md = getInterceptMarkdown('no-instance', { records });
		expect(md).toContain('Running Storybooks');
		expect(md).toContain('/a');
		expect(md).toContain('http://localhost:6006');
		expect(md).not.toContain('storybook-setup-claude-launch');
	});

	it('intercept() returns a tool result with isError and namespaced reason metadata', () => {
		const result = intercept('no-instance');
		expect(result.isError).toBe(true);
		expect(result._meta).toEqual({ [META_INTERCEPT_REASON]: 'no-instance' });
		expect(META_INTERCEPT_REASON).toBe('storybook.dev/interceptReason');
		expect(result.content[0]?.type).toBe('text');
	});
});
