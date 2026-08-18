import { describe, expect, it } from 'vitest';

import { coverageDelta, isDsCoverage } from './coverage.ts';

import type { DsCoverage } from './coverage.ts';

function slice(ds: number, instanceDs: number | null): DsCoverage {
	const nodes = { all: 10, host: 4, component: 6, ds, external: 0, local: 6 - ds, unresolved: 0 };
	return {
		dsPackages: ['@ds/*'],
		files: 2,
		nodes,
		dsShareOfAllNodes: ds / 10,
		dsShareOfComponentNodes: ds / 6,
		parseFailures: [],
		readFailures: [],
		...(instanceDs === null
			? {}
			: {
					instances: {
						nodes: { ...nodes, ds: instanceDs, all: 20 },
						dsShareOfAllNodes: instanceDs / 20,
						dsShareOfComponentNodes: instanceDs / 6,
					},
				}),
	};
}

describe('coverageDelta instances', () => {
	it('spans instance totals and shares when both sides carry them', () => {
		const delta = coverageDelta(slice(2, 4), slice(3, 8));
		expect(delta.instances?.nodes.ds).toEqual({ before: 4, after: 8, delta: 4 });
		expect(delta.instances?.dsShareOfAllNodes).toEqual({ before: 0.2, after: 0.4, delta: 0.2 });
	});

	it('is null when either side predates instance measurement', () => {
		expect(coverageDelta(slice(2, null), slice(3, 8)).instances).toBeNull();
		expect(coverageDelta(slice(2, 4), slice(3, null)).instances).toBeNull();
	});

	it('accepts a stored slice without instances', () => {
		expect(isDsCoverage(slice(2, null))).toBe(true);
	});
});
