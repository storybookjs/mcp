// Finding stored runs on disk, and narrowing them the way every analysis CLI does.
//
// Layout: results/<experiment>/<model>/<timestamp>/<eval>/run-N/project
//
// Shared rather than duplicated: analyze-results.ts and judge-ds-misuse.ts must
// agree about what a run is and what --experiment/--since/--latest select, or
// the two will quietly disagree about which runs they covered.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { matchesAnySelector, type selectionFlags } from '#lib/agentic-reference/selection';

export interface Run {
	runDir: string;
	projectDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
}

export interface RunSelection {
	experiments: string[];
	evals: string[];
	since: string | null;
	latest: boolean;
}

/**
 * The four selection flags, in the shared grammar, ready to be spread into
 * whatever else a CLI declares of its own.
 *
 * Shared for the same reason findRuns and selectRuns are, and needed more: the
 * two CLIs agreeing about what a run *is* buys nothing if they disagree about
 * what --since selects. Declared once here, so a spelling can only be added to
 * both at the same time.
 *
 * `flags` must be the same object the caller hands to `flags.parser`, because
 * `switch` records the flag it built so `--latest=1` can be normalized.
 */
export function runSelectionOptions(flags: ReturnType<typeof selectionFlags>) {
	return {
		experiments: flags.experiments,
		evals: flags.evals,
		since: flags.text('since', 'Only runs stamped on or after this ISO date'),
		latest: flags.switch('latest', 'Only the newest result directory per experiment'),
	} as const;
}

/** What a parse of those flags selects. */
export function toRunSelection(parsed: {
	experiments: string[];
	evals: string[];
	since?: string | undefined;
	latest?: boolean | undefined;
}): RunSelection {
	return {
		experiments: parsed.experiments,
		evals: parsed.evals,
		since: parsed.since ?? null,
		latest: parsed.latest === true,
	};
}

export function findRuns(resultsDir: string): Run[] {
	if (!existsSync(resultsDir)) return [];
	const runs: Run[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(resultsDir.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0]!,
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3)!,
				evalName: parts.at(-2)!,
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(resultsDir);
	return runs;
}

// Result directories are ISO timestamps with the time's ':' replaced by '-',
// e.g. 2026-07-27T10-43-55.864Z.
export function parseTimestamp(timestamp: string): Date {
	return new Date(timestamp.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}

export function selectRuns(runs: Run[], options: RunSelection): Run[] {
	let selected = runs;
	selected = selected.filter(
		(run) =>
			matchesAnySelector(run.experiment, options.experiments) &&
			matchesAnySelector(run.evalName, options.evals),
	);
	if (options.since) {
		const since = new Date(options.since);
		if (Number.isNaN(since.getTime())) {
			throw new Error(`--since must be a parseable date; received "${options.since}"`);
		}
		selected = selected.filter((run) => parseTimestamp(run.timestamp) >= since);
	}
	if (options.latest) {
		const newest = new Map<string, string>();
		for (const run of selected) {
			const current = newest.get(run.experiment);
			if (current === undefined || run.timestamp > current)
				newest.set(run.experiment, run.timestamp);
		}
		selected = selected.filter((run) => run.timestamp === newest.get(run.experiment));
	}
	return selected;
}
