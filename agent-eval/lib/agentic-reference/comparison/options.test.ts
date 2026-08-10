import { describe, expect, it } from 'vitest';

import { parseCompareArgs } from './options.ts';

describe('parseCompareArgs', () => {
	it('applies defaults', () => {
		expect(parseCompareArgs([])).toEqual({
			control: undefined,
			cases: undefined,
			workflows: undefined,
			minRuns: 10,
			allBatches: false,
			out: undefined,
		});
	});

	it('parses every flag', () => {
		expect(
			parseCompareArgs([
				'--control=control-none',
				'--cases=do-dont,full',
				'--workflows=701,703',
				'--min-runs=5',
				'--all-batches',
				'--out=/tmp/x',
			]),
		).toEqual({
			control: 'control-none',
			cases: 'do-dont,full',
			workflows: '701,703',
			minRuns: 5,
			allBatches: true,
			out: '/tmp/x',
		});
	});

	it('rejects unknown arguments and bad min-runs', () => {
		expect(() => parseCompareArgs(['--nope'])).toThrow('Unknown argument "--nope"');
		expect(() => parseCompareArgs(['--min-runs=0'])).toThrow(/min-runs/);
		expect(() => parseCompareArgs(['--min-runs=x'])).toThrow(/min-runs/);
	});
});
