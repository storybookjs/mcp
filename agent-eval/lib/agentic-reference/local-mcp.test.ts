import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	LOCAL_STORYBOOK_MCP_PORT,
	type StorybookMcpPackageSpec,
	assertStorybookMcpPackageSpec,
	buildLocalMcpSetupScript,
	packageTarballUrl,
	resolveStorybookMcpPackage,
} from './local-mcp.ts';

const SPEC: StorybookMcpPackageSpec = {
	repo: 'storybook-tmp/base-ui',
	packageName: '@storybook-tmp/baseui-mcp',
	branch: 'experiment/empty',
};

const SHA = 'a'.repeat(40);

// Every field is interpolated into a bash script, so malformed means
// shell-unsafe as much as it means typo'd.
const MALFORMED: Array<[string, StorybookMcpPackageSpec]> = [
	['a space in the repo', { ...SPEC, repo: 'a b/c' }],
	['a repo without an owner', { ...SPEC, repo: 'base-ui' }],
	['a shell substitution in the branch', { ...SPEC, branch: '$(id)' }],
	['a quote in the package name', { ...SPEC, packageName: "a'b" }],
	['a semicolon in the package name', { ...SPEC, packageName: 'a;rm' }],
];

describe('assertStorybookMcpPackageSpec', () => {
	it('accepts a well-formed spec', () => {
		expect(() => assertStorybookMcpPackageSpec(SPEC)).not.toThrow();
	});

	it.each(MALFORMED)('throws on %s', (_label, spec) => {
		expect(() => assertStorybookMcpPackageSpec(spec)).toThrow(/storybookMcpPackage/);
	});
});

describe('packageTarballUrl', () => {
	it('builds the sha-addressed long-form pkg.pr.new URL', () => {
		expect(packageTarballUrl(SPEC, SHA)).toBe(
			`https://pkg.pr.new/storybook-tmp/base-ui/@storybook-tmp/baseui-mcp@${SHA}`,
		);
	});
});

describe('buildLocalMcpSetupScript', () => {
	it('embeds the tarball URL and port, and keeps plumbing outside the workspace', () => {
		const script = buildLocalMcpSetupScript(packageTarballUrl(SPEC, SHA), LOCAL_STORYBOOK_MCP_PORT);
		expect(script).toContain(`@storybook-tmp/baseui-mcp@${SHA}`);
		expect(script).toContain(`--port ${LOCAL_STORYBOOK_MCP_PORT}`);
		expect(script).toContain('$HOME/.storybook-mcp');
		expect(script).toContain('"method":"initialize"');
	});
});

describe('resolveStorybookMcpPackage', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// The module-level resolution cache is keyed by repo@branch and shared across
	// tests, so each test resolves its own branch name.
	it('resolves the branch head and records it for the run pin', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ sha: SHA }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const spec = { ...SPEC, branch: 'experiment/resolve-test' };
		await expect(resolveStorybookMcpPackage(spec)).resolves.toEqual({ ...spec, sha: SHA });
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/repos/storybook-tmp/base-ui/commits/experiment%2Fresolve-test',
			expect.anything(),
		);
	});

	it('caches per repo@branch so every run of an experiment pins the same sha', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ sha: SHA }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const spec = { ...SPEC, branch: 'experiment/cache-test' };
		await resolveStorybookMcpPackage(spec);
		await resolveStorybookMcpPackage(spec);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports the branch and the publish prerequisite on an API error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));

		await expect(
			resolveStorybookMcpPackage({ ...SPEC, branch: 'experiment/missing-test' }),
		).rejects.toThrow(/experiment\/missing-test.*storybook-mcp-preview/s);
	});

	it('rejects a malformed commits API response', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ sha: 'not-a-sha' }), { status: 200 })),
		);

		await expect(
			resolveStorybookMcpPackage({ ...SPEC, branch: 'experiment/malformed-test' }),
		).rejects.toThrow(/unexpected commits API response/);
	});

	it('never resolves before validating the spec', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(resolveStorybookMcpPackage({ ...SPEC, branch: '$(id)' })).rejects.toThrow(
			/storybookMcpPackage/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
