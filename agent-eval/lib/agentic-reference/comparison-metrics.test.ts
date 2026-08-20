import { describe, expect, it } from 'vitest';

import { COMPARISON_METRICS, metricValueAt } from './comparison-metrics.ts';

describe('COMPARISON_METRICS', () => {
	it('has 24 unique keys and unique paths', () => {
		expect(COMPARISON_METRICS).toHaveLength(24);
		expect(new Set(COMPARISON_METRICS.map((m) => m.key)).size).toBe(24);
		expect(new Set(COMPARISON_METRICS.map((m) => m.path)).size).toBe(24);
	});

	it('reads the 2026-08-20 additions from fields the analyzers always wrote', () => {
		const paths = new Map(COMPARISON_METRICS.map((m) => [m.key, m.path]));
		expect(paths.get('meanEditsPerFile')).toBe('churn.meanEditsPerFile');
		expect(paths.get('maxEditsPerFile')).toBe('churn.maxEditsPerFile');
		expect(paths.get('dsShareOfAllNodesDelta')).toBe(
			'deltaToBaseline.coverageDelta.dsShareOfAllNodes.delta',
		);
		expect(paths.get('dsShareOfComponentNodesDelta')).toBe(
			'deltaToBaseline.coverageDelta.dsShareOfComponentNodes.delta',
		);
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
		expect(log0Keys).toEqual([]);
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
