/**
 * Split a unified git diff into per-file hunks.
 *
 * `git diff` emits one `diff --git a/<path> b/<path>` section per file.
 * `ReviewFixture.diffHunks` wants exactly that breakdown — one
 * `{ path, hunk }` per file — so a promoted fixture carries the change
 * both as the whole `diff` and as per-file pieces.
 */
export interface FileDiffHunk {
	path: string;
	hunk: string;
}

export function splitUnifiedDiff(diff: string): FileDiffHunk[] {
	if (!diff.trim()) return [];
	const hunks: FileDiffHunk[] = [];
	let current: { path: string; lines: string[] } | undefined;
	const flush = () => {
		if (current) hunks.push({ path: current.path, hunk: current.lines.join('\n') });
	};
	for (const line of diff.split('\n')) {
		const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
		if (m) {
			flush();
			// Use the `b/` (destination) path so renames name the new file.
			current = { path: m[2]!, lines: [line] };
		} else if (current) {
			current.lines.push(line);
		}
	}
	flush();
	return hunks;
}
