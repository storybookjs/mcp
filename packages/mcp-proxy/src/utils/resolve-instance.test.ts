import { describe, expect, it } from 'vitest';
import { storybookNeedsUpgrade, resolveInstance } from './resolve-instance.ts';
import type { McpStatusV1, StorybookInstanceRecordV1 } from '../types/index.ts';

let nextInstance = 0;

function record(
	cwd: string,
	status: McpStatusV1 = 'ready',
	overrides: Partial<StorybookInstanceRecordV1> = {},
): StorybookInstanceRecordV1 {
	nextInstance += 1;
	return {
		schemaVersion: 1,
		instanceId: `inst-${nextInstance}`,
		pid: 1000 + nextInstance,
		cwd,
		url: `http://localhost:${6000 + nextInstance}`,
		port: 6000 + nextInstance,
		mcp: {
			status,
			endpoint:
				status === 'ready' || status === 'error'
					? `http://localhost:${6000 + nextInstance}/mcp`
					: undefined,
		},
		...overrides,
	};
}

describe('resolveInstance', () => {
	it('returns no-instance with empty candidates when registry is empty', () => {
		const result = resolveInstance([], '/Users/x/projects/foo');
		expect(result).toEqual({ kind: 'intercept', reason: 'no-instance', records: [] });
	});

	it('returns no-instance with candidates when no record cwd matches', () => {
		const a = record('/Users/x/projects/foo');
		const b = record('/Users/x/projects/bar');
		const result = resolveInstance([a, b], '/Users/x/projects/baz');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('no-instance');
			expect(result.records).toEqual([a, b]);
		}
	});

	it('matches a record by exact normalized cwd', () => {
		const r = record('/Users/x/projects/foo');
		const result = resolveInstance([r], '/Users/x/projects/foo');
		expect(result).toEqual({ kind: 'instance', record: r });
	});

	it('normalizes trailing slashes and dot segments before matching', () => {
		const r = record('/Users/x/projects/foo');
		const result = resolveInstance([r], '/Users/x/projects/foo/./');
		expect(result).toEqual({ kind: 'instance', record: r });
	});

	it('does NOT match a child path of a record cwd (exact only)', () => {
		const r = record('/Users/x/projects/foo');
		const result = resolveInstance([r], '/Users/x/projects/foo/src/Button.tsx');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('no-instance');
		}
	});

	it('does NOT match a sibling string prefix', () => {
		const r = record('/Users/x/projects/foo');
		const result = resolveInstance([r], '/Users/x/projects/foobar');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('no-instance');
		}
	});

	it('returns multiple-matches when 2+ records share the same exact cwd', () => {
		const a = record('/Users/x/projects/foo');
		const b = record('/Users/x/projects/foo');
		const result = resolveInstance([a, b], '/Users/x/projects/foo');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('multiple-matches');
			expect(result.records).toEqual([a, b]);
		}
	});

	it('dispatches mcp.status=starting as mcp-starting intercept', () => {
		const r = record('/p', 'starting');
		const result = resolveInstance([r], '/p');
		expect(result).toEqual({ kind: 'intercept', reason: 'mcp-starting' });
	});

	it('dispatches mcp.status=not-installed as addon-missing intercept', () => {
		const r = record('/p', 'not-installed');
		const result = resolveInstance([r], '/p');
		expect(result).toEqual({ kind: 'intercept', reason: 'addon-missing' });
	});

	it('dispatches mcp.status=error as mcp-error intercept', () => {
		const r = record('/p', 'error');
		const result = resolveInstance([r], '/p');
		expect(result).toEqual({ kind: 'intercept', reason: 'mcp-error' });
	});

	it('dispatches storybook-needs-upgrade before status when storybookVersion is below the floor', () => {
		// `not-installed` would normally surface `addon-missing`; the version
		// gate must override so we don't tell the user to install an addon that
		// is incompatible with their Storybook.
		const r = record('/p', 'not-installed', { storybookVersion: '8.6.0' });
		const result = resolveInstance([r], '/p');
		expect(result).toEqual({ kind: 'intercept', reason: 'storybook-needs-upgrade', records: [r] });
	});

	it('still gates a `ready` instance when its storybookVersion is too old', () => {
		const r = record('/p', 'ready', { storybookVersion: '9.0.0' });
		const result = resolveInstance([r], '/p');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('storybook-needs-upgrade');
		}
	});

	it('does not gate when storybookVersion is missing (older proxies)', () => {
		const r = record('/p', 'ready', { storybookVersion: undefined });
		const result = resolveInstance([r], '/p');
		expect(result).toEqual({ kind: 'instance', record: r });
	});
});

describe('storybookNeedsUpgrade', () => {
	it.each([
		['8.6.0', true],
		['9.0.0', true],
		['9.1.15', true],
		['9.1.16', false],
		['9.1.17', false],
		['9.2.0', false],
		['10.0.0', false],
		['10.1.0-alpha.0', false],
		// Unparseable strings are treated as unknown → not too old.
		['', false],
		['unknown', false],
	] as const)('%s → %s', (version, expected) => {
		expect(storybookNeedsUpgrade(version)).toBe(expected);
	});

	it('returns false for undefined (no metadata)', () => {
		expect(storybookNeedsUpgrade(undefined)).toBe(false);
	});
});
