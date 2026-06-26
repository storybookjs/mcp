import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { evalRuns } from './experiments.ts';

describe('evalRuns', () => {
	const original = process.env.EVAL_RUNS;

	beforeEach(() => {
		delete process.env.EVAL_RUNS;
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.EVAL_RUNS;
		} else {
			process.env.EVAL_RUNS = original;
		}
	});

	test('defaults to 1 when EVAL_RUNS is unset', () => {
		expect(evalRuns()).toBe(1);
	});

	test('defaults to 1 when EVAL_RUNS is empty or whitespace', () => {
		process.env.EVAL_RUNS = '   ';
		expect(evalRuns()).toBe(1);
	});

	test('parses a positive integer', () => {
		process.env.EVAL_RUNS = '5';
		expect(evalRuns()).toBe(5);
	});

	test.each(['0', '-2', '2.5', 'abc'])('throws on invalid value %j', (value) => {
		process.env.EVAL_RUNS = value;
		expect(() => evalRuns()).toThrow(/Invalid EVAL_RUNS/);
	});
});
