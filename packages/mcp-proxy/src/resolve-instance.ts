import { resolve, sep } from 'node:path';
import type { StorybookInstanceRecord, InterceptReason } from './types.ts';

export type ResolveResult =
	| { kind: 'instance'; record: StorybookInstanceRecord; fallback?: boolean }
	| { kind: 'intercept'; reason: InterceptReason; records?: StorybookInstanceRecord[] };

/**
 * Pick the Storybook instance that owns `targetPath`.
 *
 * Strategy: among records whose `cwd` is a prefix of `targetPath`, pick the one
 * with the longest `cwd` (innermost project). Ties or zero matches escalate to
 * an intercept.
 *
 * When `targetPath` matches no record, fall back to the only running instance
 * if exactly one exists; this covers the common single-project case where the
 * agent didn't pass a path and the proxy's cwd doesn't sit under any project
 * root (e.g. the ADE launched the proxy from `$HOME`). The result is flagged
 * `fallback: true` so callers can warn — silently returning a sibling project's
 * data would be a worse failure mode in monorepos.
 */
export function resolveInstance(
	records: StorybookInstanceRecord[],
	targetPath: string,
): ResolveResult {
	if (records.length === 0) {
		return { kind: 'intercept', reason: 'no-instance' };
	}

	const normalised = ensureTrailingSep(resolve(targetPath));
	const matches = records.filter((r) => normalised.startsWith(ensureTrailingSep(resolve(r.cwd))));

	if (matches.length === 0) {
		if (records.length === 1) {
			return readyOrIntercept(records[0]!, { fallback: true });
		}
		return { kind: 'intercept', reason: 'multiple-matches', records };
	}

	if (matches.length > 1) {
		matches.sort((a, b) => b.cwd.length - a.cwd.length);
		if (matches[0]!.cwd.length === matches[1]!.cwd.length) {
			return { kind: 'intercept', reason: 'multiple-matches', records: matches };
		}
	}

	return readyOrIntercept(matches[0]!);
}

function readyOrIntercept(
	record: StorybookInstanceRecord,
	options: { fallback?: boolean } = {},
): ResolveResult {
	if (!record.mcp.ready) {
		return { kind: 'intercept', reason: 'mcp-starting' };
	}
	return { kind: 'instance', record, ...(options.fallback ? { fallback: true } : {}) };
}

function ensureTrailingSep(p: string): string {
	return p.endsWith(sep) ? p : p + sep;
}
