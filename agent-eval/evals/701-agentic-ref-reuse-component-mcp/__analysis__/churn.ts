// How many times the agent rewrote each file. Fewer passes over the same file
// suggests it understood the change before making it.
//
// Shell writes must be counted, not just structured Edit/Write calls: the
// captured run edited via `cp` and `sed -i`, and `o11y.filesModified` lists
// only Footer.tsx as a result. Agents also differ in how much they reach for
// the shell, so ignoring it would bias any cross-agent comparison.
//
// Scratch files count too, deliberately. The captured run wrote two throwaway
// test harnesses inside the workspace and deleted them again, so it reports
// three files edited where only one survived. Every write the agent made is an
// edit, and needing scaffolding to get a change right is itself iteration.
// Consequence to keep in mind when reading the numbers: these counts do not
// reconcile with the SLoC diff, which only ever sees files that survived.
import { isRecord } from '../../../lib/shell-parse.ts';
import { splitCommandSegments } from './shell-segments.ts';

export interface ChurnMetrics {
	/** Workspace-relative path to number of write operations. */
	perFile: Record<string, number>;
	filesEdited: number;
	/** null when no file was edited — distinct from an average that came out 0. */
	maxEditsPerFile: number | null;
	meanEditsPerFile: number | null;
}

/** Binaries whose *last* path argument is the file being written. */
const WRITES_LAST_ARGUMENT = new Set(['cp', 'mv', 'tee', 'touch', 'ln']);
/** Binaries where every path argument is affected. */
const WRITES_EVERY_ARGUMENT = new Set(['rm', 'mkdir', 'chmod']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function isPathLike(token: string): boolean {
	return token !== '' && !token.startsWith('-');
}

/**
 * Workspace-relative form of a path, or null when it lies outside the workspace.
 * Absolute paths elsewhere (/tmp) are scratch space, not the codebase under
 * evaluation.
 */
function normalize(rawPath: string, workspaceRoot: string): string | null {
	const path = rawPath.replace(/^['"]|['"]$/g, '');
	if (path.startsWith(workspaceRoot)) return path.slice(workspaceRoot.length);
	if (path.startsWith('/')) return null;
	return path.replace(/^\.\//, '');
}

function collectShellWrites(command: string, workspaceRoot: string, into: string[]): void {
	const push = (rawPath: string | undefined): void => {
		if (rawPath === undefined) return;
		const normalized = normalize(rawPath, workspaceRoot);
		if (normalized !== null) into.push(normalized);
	};

	for (const segment of splitCommandSegments(command)) {
		if (segment.piped) continue;

		// The splitter has already discarded `2>` and `/dev/null` targets, so a
		// non-null target here is a genuine content write.
		if (segment.redirectTarget !== null) push(segment.redirectTarget);

		let index = 0;
		const { tokens } = segment;
		while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index] ?? '')) index += 1;
		const head = (tokens[index] ?? '').replace(/^.*\//, '');
		const args = tokens.slice(index + 1);

		if (head === 'sed' || head === 'awk') {
			if (!args.some((token) => token === '-i' || token.startsWith('-i'))) continue;
			// The last path-like argument is the file edited in place; the ones
			// before it are the script and its flags.
			push(args.filter(isPathLike).at(-1));
			continue;
		}

		if (WRITES_LAST_ARGUMENT.has(head)) {
			push(args.filter(isPathLike).at(-1));
			continue;
		}

		if (WRITES_EVERY_ARGUMENT.has(head)) {
			for (const token of args.filter(isPathLike)) push(token);
		}
	}
}

export function computeChurn(events: unknown[], workspaceRoot = '/workspace/'): ChurnMetrics {
	const written: string[] = [];

	for (const event of events) {
		if (!isRecord(event) || event.type !== 'tool_call' || !isRecord(event.tool)) continue;
		const { name, args } = event.tool;

		if ((name === 'file_edit' || name === 'file_write') && isRecord(args)) {
			const filePath = args.file_path;
			if (typeof filePath === 'string') {
				const normalized = normalize(filePath, workspaceRoot);
				if (normalized !== null) written.push(normalized);
			}
			continue;
		}

		if (name === 'shell' && isRecord(args) && typeof args.command === 'string') {
			collectShellWrites(args.command, workspaceRoot, written);
		}
	}

	const perFile: Record<string, number> = {};
	for (const path of written) perFile[path] = (perFile[path] ?? 0) + 1;

	const counts = Object.values(perFile);
	return {
		perFile,
		filesEdited: counts.length,
		maxEditsPerFile: counts.length === 0 ? null : Math.max(...counts),
		meanEditsPerFile:
			counts.length === 0 ? null : counts.reduce((sum, count) => sum + count, 0) / counts.length,
	};
}
