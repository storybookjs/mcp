import { describe, expect, it } from 'vitest';

import { COMPARISON_METRICS, metricValueAt } from './comparison-metrics.ts';

describe('COMPARISON_METRICS', () => {
	it('has 20 unique keys and unique paths', () => {
		expect(COMPARISON_METRICS).toHaveLength(20);
		expect(new Set(COMPARISON_METRICS.map((m) => m.key)).size).toBe(20);
		expect(new Set(COMPARISON_METRICS.map((m) => m.path)).size).toBe(20);
	});

	it('only applies log to strictly-positive continuous metrics', () => {
		const logKeys = COMPARISON_METRICS.filter((m) => m.transform === 'log').map((m) => m.key);
		expect(logKeys.sort()).toEqual([
			'durationSeconds',
			'estimatedCostUsd',
			'inputTokens',
			'outputTokens',
		]);
		const log0Keys = COMPARISON_METRICS.filter((m) => m.transform === 'log0').map((m) => m.key);
		expect(log0Keys).toEqual(['slocAdded']);
	});
});

describe('metricValueAt', () => {
	const analysis = {
		speed: { durationSeconds: 227.4 },
		deltaToBaseline: { complexity: { cognitive: { delta: -2 } } },
		toolUse: null,
	};

	it('reads a nested numeric leaf', () => {
		expect(metricValueAt(analysis, 'speed.durationSeconds')).toBe(227.4);
		expect(metricValueAt(analysis, 'deltaToBaseline.complexity.cognitive.delta')).toBe(-2);
	});

	it('returns null for missing segments, null branches, and non-numbers', () => {
		expect(metricValueAt(analysis, 'speed.nope')).toBeNull();
		expect(metricValueAt(analysis, 'toolUse.buckets.docs')).toBeNull();
		expect(metricValueAt({ a: 'x' }, 'a')).toBeNull();
		expect(metricValueAt({ a: Number.NaN }, 'a')).toBeNull();
	});
});
