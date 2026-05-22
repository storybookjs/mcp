import { resolve } from 'node:path';
import { lt, valid } from 'semver';
import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';

export type ResolveResult =
	| { kind: 'instance'; record: StorybookInstanceRecordV1 }
	| { kind: 'intercept'; reason: InterceptReason; records?: StorybookInstanceRecordV1[] };

/**
 * Minimum Storybook version that ships a compatible `@storybook/addon-mcp`.
 * 
 * @see packages/addon-mcp/packages.json `peerDependencies`
 */
export const MIN_SUPPORTED_STORYBOOK_VERSION = '9.1.16';

export function storybookNeedsUpgrade(version: string | undefined): boolean {
	const parsed = version ? valid(version) : null;
	if (!parsed) return false;
	return lt(parsed, MIN_SUPPORTED_STORYBOOK_VERSION);
}

/**
 * Pick the Storybook instance whose cwd exactly matches `targetCwd` after
 * normalisation. Per milestone 2 of storybookjs/storybook#34826: matching is
 * exact-normalized, with no longest-prefix or fallback behaviour.
 *
 * If a single record matches, the version gate runs first (an out-of-date
 * Storybook preempts every status), then dispatch based on `mcp.status`:
 *   - ready          → proxy
 *   - starting       → mcp-starting intercept
 *   - not-installed  → addon-missing intercept
 *   - error          → mcp-error intercept
 *
 * Zero matches → no-instance intercept (callers may surface running cwds).
 * Two or more matches at the same cwd → multiple-matches intercept (degenerate).
 */
export function resolveInstance(
	records: StorybookInstanceRecordV1[],
	targetCwd: string,
): ResolveResult {
	const normalisedTarget = resolve(targetCwd);
	const matches = records.filter((r) => resolve(r.cwd) === normalisedTarget);

	if (matches.length === 0) {
		return { kind: 'intercept', reason: 'no-instance', records };
	}
	if (matches.length > 1) {
		return { kind: 'intercept', reason: 'multiple-matches', records: matches };
	}
	const record = matches[0]!;

	if (storybookNeedsUpgrade(record.storybookVersion)) {
		return { kind: 'intercept', reason: 'storybook-needs-upgrade', records: [record] };
	}
	switch (record.mcp.status) {
		case 'ready':
			return { kind: 'instance', record };
		case 'starting':
			return { kind: 'intercept', reason: 'mcp-starting' };
		case 'not-installed':
			return { kind: 'intercept', reason: 'addon-missing' };
		case 'error':
			return { kind: 'intercept', reason: 'mcp-error' };
	}
}
