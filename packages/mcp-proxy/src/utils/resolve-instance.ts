import { resolve } from 'node:path';
import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';

export type ResolveResult =
	| {
			kind: 'instance';
			record: StorybookInstanceRecordV1;
			matches: StorybookInstanceRecordV1[];
	  }
	| {
			kind: 'intercept';
			reason: InterceptReason;
			records?: StorybookInstanceRecordV1[];
			matches: StorybookInstanceRecordV1[];
	  };

/**
 * Pick the Storybook instance whose cwd exactly matches `targetCwd` after
 * normalisation. Per milestone 2 of storybookjs/storybook#34826: matching is
 * exact-normalized, with no longest-prefix or fallback behaviour.
 *
 * When `targetPort` is supplied (e.g. an ADE that launched Storybook on a
 * known port and wants to address that exact instance), it further constrains
 * the cwd matches: an instance must match BOTH cwd and port. If the cwd matches
 * but no instance there is on `targetPort`, a `port-mismatch` intercept is
 * returned with the cwd's instances as candidates so callers can surface the
 * running ports.
 *
 * If at least one record matches, dispatch based on the selected instance's
 * `mcp.status`:
 *   - ready          → proxy
 *   - starting       → mcp-starting intercept
 *   - not-installed  → addon-missing intercept
 *   - error          → mcp-error intercept
 *
 * Zero matches → no-instance intercept (callers may surface running cwds).
 * 2+ matches at the same cwd → pick a deterministic instance (lowest pid among
 * `ready` records, else lowest pid overall). All matches are returned (sorted by
 * pid) as `matches` so callers can warn the agent without blocking the call.
 */
export function resolveInstance(
	records: StorybookInstanceRecordV1[],
	targetCwd: string,
	targetPort?: number,
): ResolveResult {
	const normalisedTarget = resolve(targetCwd);
	const cwdMatches = records.filter((r) => resolve(r.cwd) === normalisedTarget);
	const matches = targetPort == null ? cwdMatches : cwdMatches.filter((r) => r.port === targetPort);

	if (matches.length === 0) {
		// cwd matched, but no instance there is on the requested port: a distinct,
		// more actionable failure than "nothing is running here".
		if (targetPort != null && cwdMatches.length > 0) {
			return {
				kind: 'intercept',
				reason: 'port-mismatch',
				records: cwdMatches,
				matches: [],
			};
		}
		return {
			kind: 'intercept',
			reason: 'no-instance',
			records,
			matches: [],
		};
	}

	const sortedMatches = [...matches].sort((a, b) => a.pid - b.pid);
	const selected = sortedMatches.find((r) => r.mcp.status === 'ready') ?? sortedMatches[0]!;

	switch (selected.mcp.status) {
		case 'ready':
			return {
				kind: 'instance',
				record: selected,
				matches: sortedMatches,
			};

		case 'starting':
			return {
				kind: 'intercept',
				reason: 'mcp-starting',
				matches: sortedMatches,
			};

		case 'not-installed':
			return {
				kind: 'intercept',
				reason: 'addon-missing',
				matches: sortedMatches,
			};

		case 'error':
			return {
				kind: 'intercept',
				reason: 'mcp-error',
				matches: sortedMatches,
			};
	}
}
