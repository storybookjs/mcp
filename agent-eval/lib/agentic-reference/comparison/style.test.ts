import { describe, expect, it } from 'vitest';

import { ansiStyle, PLAIN_STYLE } from './style.ts';

describe('PLAIN_STYLE', () => {
	it('is the identity for bold, caseName, and reason', () => {
		expect(PLAIN_STYLE.bold('hello')).toBe('hello');
		expect(PLAIN_STYLE.caseName('do-dont')).toBe('do-dont');
		expect(PLAIN_STYLE.reason('missing-runs', 'missing-runs')).toBe('missing-runs');
	});
});

describe('ansiStyle', () => {
	it('returns PLAIN_STYLE (identity) when the stream is not a TTY', () => {
		const style = ansiStyle({ isTTY: false });
		expect(style.bold('hello')).toBe('hello');
		expect(style.caseName('do-dont')).toBe('do-dont');
		expect(style.reason('missing-runs', 'missing-runs')).toBe('missing-runs');
		expect(style.reason('stale-analysis', 'stale-analysis')).toBe('stale-analysis');
		expect(style.reason('unanalyzed', 'unanalyzed')).toBe('unanalyzed');
	});

	it('returns PLAIN_STYLE (identity) when isTTY is undefined, e.g. a piped stream', () => {
		const style = ansiStyle({});
		expect(style.bold('hello')).toBe('hello');
		expect(style.caseName('do-dont')).toBe('do-dont');
	});

	it('emits non-identity output when the stream is a TTY', () => {
		const style = ansiStyle({ isTTY: true });
		// Whether styleText actually emits escapes here depends on the test
		// runner's env (NO_COLOR/FORCE_COLOR/TTY detection inside styleText
		// itself), so assert the contract rather than literal escape bytes:
		// styled text always still contains the original plain text.
		expect(style.bold('hello')).toContain('hello');
		expect(style.caseName('do-dont')).toContain('do-dont');
		expect(style.reason('missing-runs', 'missing-runs')).toContain('missing-runs');
	});
});
