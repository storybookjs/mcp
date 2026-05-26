import { resolve } from 'node:path';
import type { InterceptReason, StorybookInstanceRecordV1 } from '../types/index.ts';

export type ResolveResult =
	| {
			kind: 'instance';
			record: StorybookInstanceRecordV1;
			siblings?: StorybookInstanceRecordV1[];
	  }
	| { kind: 'intercept'; reason: InterceptReason; records?: StorybookInstanceRecordV1[] };

/**
 * Pick the Storybook instance whose cwd exactly matches `targetCwd` after
 * normalisation. Per milestone 2 of storybookjs/storybook#34826: matching is
 * exact-normalized, with no longest-prefix or fallback behaviour.
 *
 * If a single record matches, dispatch based on `mcp.status`:
 *   - ready          → proxy
 *   - starting       → mcp-starting intercept
 *   - not-installed  → addon-missing intercept
 *   - error          → mcp-error intercept
 *
 * Zero matches → no-instance intercept (callers may surface running cwds).
 * 2+ matches at the same cwd → pick a deterministic instance (lowest pid among
 * `ready` records, else lowest pid overall) and surface the others as
 * `siblings` so callers can warn the agent without blocking the call.
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

	const sorted = [...matches].sort((a, b) => a.pid - b.pid);
	const chosen = sorted.find((r) => r.mcp.status === 'ready') ?? sorted[0]!;
	const siblings = matches.length > 1 ? sorted.filter((r) => r !== chosen) : undefined;

	switch (chosen.mcp.status) {
		case 'ready':
			return { kind: 'instance', record: chosen, siblings };
		case 'starting':
			return { kind: 'intercept', reason: 'mcp-starting' };
		case 'not-installed':
			return { kind: 'intercept', reason: 'addon-missing' };
		case 'error':
			return { kind: 'intercept', reason: 'mcp-error' };
	}
}
