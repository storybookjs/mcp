import { describe, expect, it } from 'vitest';
import { resolveInstance } from './resolve-instance.ts';
import type { StorybookInstanceRecord } from './types.ts';

const ready = (cwd: string, url = 'http://localhost:6006'): StorybookInstanceRecord => ({
	pid: 1,
	cwd,
	url,
	mcp: { ready: true, path: '/mcp' },
});

describe('resolveInstance', () => {
	it('returns no-instance intercept when registry is empty', () => {
		const result = resolveInstance([], '/Users/x/projects/foo');
		expect(result).toEqual({ kind: 'intercept', reason: 'no-instance' });
	});

	it('returns the matching record when one record contains the target path', () => {
		const record = ready('/Users/x/projects/foo');
		const result = resolveInstance([record], '/Users/x/projects/foo/src/Button.tsx');
		expect(result).toEqual({ kind: 'instance', record });
	});

	it('flags fallback when only one record is running and target path matches none', () => {
		const record = ready('/Users/x/projects/foo');
		const result = resolveInstance([record], '/Users/x/somewhere/else');
		expect(result).toEqual({ kind: 'instance', record, fallback: true });
	});

	it('returns multiple-matches intercept when target matches none and several are running', () => {
		const a = ready('/Users/x/projects/foo');
		const b = ready('/Users/x/projects/bar', 'http://localhost:6007');
		const result = resolveInstance([a, b], '/Users/x/elsewhere');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('multiple-matches');
		}
	});

	it('prefers the innermost matching project on nested cwds', () => {
		const outer = ready('/Users/x/projects/foo');
		const inner = ready('/Users/x/projects/foo/packages/ui', 'http://localhost:6007');
		const result = resolveInstance(
			[outer, inner],
			'/Users/x/projects/foo/packages/ui/src/Button.tsx',
		);
		expect(result).toEqual({ kind: 'instance', record: inner });
	});

	it('returns multiple-matches when 3+ records share the longest matching cwd depth', () => {
		const a = ready('/Users/x/projects/foo', 'http://localhost:6006');
		const b = ready('/Users/x/projects/bar', 'http://localhost:6007');
		const c = ready('/Users/x/projects/baz', 'http://localhost:6008');
		// targetPath under none of them — all 3 are "matches" by depth (none), so the
		// fallback-multiple path triggers
		const result = resolveInstance([a, b, c], '/Users/x/other');
		expect(result.kind).toBe('intercept');
		if (result.kind === 'intercept') {
			expect(result.reason).toBe('multiple-matches');
		}
	});

	it('returns mcp-starting intercept when matched instance is not ready', () => {
		const record: StorybookInstanceRecord = {
			...ready('/Users/x/projects/foo'),
			mcp: { ready: false, path: '/mcp' },
		};
		const result = resolveInstance([record], '/Users/x/projects/foo/src');
		expect(result).toEqual({ kind: 'intercept', reason: 'mcp-starting' });
	});

	it('does not match a record whose cwd is a sibling string prefix', () => {
		const record = ready('/Users/x/projects/foo');
		// `/Users/x/projects/foobar` shares a string prefix but is a different directory
		const result = resolveInstance([record], '/Users/x/projects/foobar/src');
		// Falls back to the only running instance, flagged
		expect(result).toEqual({ kind: 'instance', record, fallback: true });
	});
});
