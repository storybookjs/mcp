// Small numeric helpers shared by metric aggregation.
//
// Both return null rather than a number for the empty case, because these feed
// stored metrics: a mean of "no samples" reported as 0 reads as a real measured
// zero, and an unpriced model would look like a free one.

/** Arithmetic mean, or null when there is nothing to average. */
export function mean(values: number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((total, value) => total + value, 0) / values.length;
}

/** Sum, or null when there is nothing to add. */
export function sum(values: number[]): number | null {
	return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

/**
 * Round to `digits` decimals for display, passing null through so callers can
 * chain it straight onto mean.
 *
 * Math.round breaks ties toward +Infinity, so -0.125 would round to -0.12 while
 * 0.125 rounds to 0.13. A cognitive delta below zero means the agent simplified
 * the code, and biasing those toward zero would flatter it — so the magnitude is
 * rounded and the sign reapplied, treating both directions alike.
 */
export function round(value: number | null, digits = 2): number | null {
	if (value === null) return null;
	const factor = 10 ** digits;
	return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/** The finite numbers in a list, dropping NaN, Infinity and non-numbers. */
export function finiteNumbers(values: unknown[]): number[] {
	return values.filter(
		(value): value is number => typeof value === 'number' && Number.isFinite(value),
	);
}
