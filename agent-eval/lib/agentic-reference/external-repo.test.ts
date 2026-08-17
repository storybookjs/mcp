import { describe, expect, it } from 'vitest';

import { pinOfResult, pinSlug, typecheckExternalRepo } from './external-repo.ts';

const MALFORMED: Array<[string, unknown]> = [
	['a space in the repo', { repo: 'a b', ref: 'x' }],
	['a shell substitution in the ref', { repo: 'a/b', ref: '$(id)' }],
	['a missing ref', { repo: 'a/b' }],
	['no marker at all', null],
];

describe('typecheckExternalRepo', () => {
	it('accepts a well-formed pin', () => {
		expect(typecheckExternalRepo({ repo: 'yannbf/mealdrop', ref: 'abc123' })).toEqual({
			repo: 'yannbf/mealdrop',
			ref: 'abc123',
		});
	});

	// Setup-time callers want the reason, not a bare null: a fixture with a typo'd
	// marker should say so rather than quietly run against nothing.
	it.each(MALFORMED)('throws on %s', (_label, marker) => {
		expect(() => typecheckExternalRepo(marker)).toThrow(/externalRepo/);
	});
});

describe('pinSlug', () => {
	it('escapes separators so the slug stays a single path segment', () => {
		expect(pinSlug({ repo: 'yannbf/mealdrop', ref: 'heads/main' })).toBe(
			'yannbf__mealdrop@heads__main',
		);
	});

	it('leaves a sha pin untouched, so existing cache directories keep their names', () => {
		expect(pinSlug({ repo: 'yannbf/mealdrop', ref: 'ce507b34' })).toBe('yannbf__mealdrop@ce507b34');
	});
});

describe('pinOfResult', () => {
	it('reads the pin a run recorded under analysis.externalRepo', () => {
		const result = { analysis: { externalRepo: { repo: 'a/b', ref: 'deadbeef' } } };
		expect(pinOfResult(result)).toEqual({ repo: 'a/b', ref: 'deadbeef' });
	});

	// Both CLIs walk historical runs, and one that predates the marker — or whose
	// result.json never parsed — must be skipped rather than abort the pass.
	it.each([
		['a result with no analysis', { status: 'passed' }],
		['an analysis with no marker', { analysis: {} }],
		['a malformed marker', { analysis: { externalRepo: { repo: 'a b', ref: 'x' } } }],
		['an unreadable result', null],
	])('returns null for %s', (_label, result) => {
		expect(pinOfResult(result)).toBeNull();
	});
});
