import { styleText } from 'node:util';

import type { GapReason } from './cells.ts';

export interface OutputStyle {
	bold(s: string): string;
	caseName(s: string): string;
	reason(r: GapReason, s: string): string;
}

const identity = (s: string) => s;

export const PLAIN_STYLE: OutputStyle = {
	bold: identity,
	caseName: identity,
	reason: (_r, s) => s,
};

const REASON_COLOR: Record<GapReason, 'yellow' | 'red'> = {
	'stale-analysis': 'yellow',
	unanalyzed: 'yellow',
	'missing-runs': 'red',
};

/**
 * Terminal styling gated on the stream being a real TTY, so piped/redirected
 * output (files, `| cat`, CI logs) stays plain even if NO_COLOR/FORCE_COLOR
 * would otherwise let styleText emit escapes.
 */
export function ansiStyle(stream: { isTTY?: boolean }): OutputStyle {
	if (!stream.isTTY) return PLAIN_STYLE;
	return {
		bold: (s) => styleText('bold', s),
		caseName: (s) => styleText('magenta', s),
		reason: (r, s) => styleText(REASON_COLOR[r], s),
	};
}
