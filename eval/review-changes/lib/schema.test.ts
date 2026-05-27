/**
 * Pin the eval-side `ReviewStateSchema` to the canonical one in
 * `@storybook/addon-mcp`. If addon-mcp ever changes its schema, this test
 * fails and we know to update `schema.ts` (or vice-versa). The eval
 * deliberately re-declares the schema so it has no build-time coupling
 * to the addon's dist output, but the contract is round-trippable.
 */
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { ReviewStateSchema } from './schema.ts';
import { ReviewStateSchema as CanonicalReviewStateSchema } from '../../../packages/addon-mcp/src/review-state-store.ts';

const sample = {
	title: 'pinned',
	description: 'pinned',
	collections: [
		{
			title: 'L',
			rationale: 'R',
			storyIds: ['a--1'],
			kind: 'atomic',
		},
	],
	changedFiles: ['x.tsx'],
	diffHunks: [{ path: 'x.tsx', hunk: '@@' }],
	storyMeta: { 'a--1': { depth: 0, chain: [] } },
};

describe('ReviewStateSchema pinning', () => {
	it('accepts the same payload as @storybook/addon-mcp', () => {
		expect(v.is(ReviewStateSchema, sample)).toBe(true);
		expect(v.is(CanonicalReviewStateSchema, sample)).toBe(true);
	});

	it('rejects the same malformed payload in both', () => {
		const bad = { title: 1, collections: 'no' };
		expect(v.is(ReviewStateSchema, bad)).toBe(false);
		expect(v.is(CanonicalReviewStateSchema, bad)).toBe(false);
	});

	it('accepts payloads missing optional fields', () => {
		const minimal = { title: 't', description: 'd', collections: [] };
		expect(v.is(ReviewStateSchema, minimal)).toBe(true);
		expect(v.is(CanonicalReviewStateSchema, minimal)).toBe(true);
	});
});
