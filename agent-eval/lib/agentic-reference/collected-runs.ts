// Which stored run directories are actually runs.
//
// A run that stops on something outside the experiment — a 402 from the
// gateway, an eval timeout, an MCP endpoint that would not answer, the host
// killing a container — still leaves a directory behind: result.json with an
// `error`, a transcript of however far it got, and no `project`. The project
// tree is what every metric is measured from, so such a directory is a record
// of an interruption, not a measurement.
//
// WHY BOTH READERS OF THE TREE NEED THIS. The offline analyzer skipped those
// directories already, silently; the plan runner counted them, so a cell whose
// ten attempts had all died on billing looked complete and was never
// re-collected. One tree, two answers, and the wrong one was the one deciding
// what to collect. Both now count the same thing: runs that produced a tree.
//
// The harness has its own failure classifier, which deletes infra and timeout
// runs unless `--ack-failures` is passed. This is the backstop for what it
// leaves behind — a batch that died before classification, results downloaded
// from CI, a run acknowledged at the time and regretted later.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { readJson } from '../utils/files.ts';

const RUN_DIR = /^run-(\d+)$/;

/** What a stored run directory turned out to be. */
export interface RunOutcome {
	/** Absolute path to the run directory. */
	dir: string;
	/** Its 1-based repetition number, from the directory name. */
	run: number;
	/**
	 * Whether the run produced a project tree — the thing every metric reads, and
	 * so the thing that makes a directory a measurement rather than a record of
	 * an interruption. A run whose eval *failed* still collected: the tree it
	 * left behind is exactly what the analysis is there to measure.
	 */
	collected: boolean;
	/** What the harness recorded as the reason it stopped, where it recorded one. */
	error: string | null;
}

/** Reads one run directory, whether or not it holds a run. */
export function readRunOutcome(runDir: string): RunOutcome {
	const name = basename(runDir);
	const result = readJson<{ error?: unknown }>(join(runDir, 'result.json'));
	return {
		dir: runDir,
		run: Number.parseInt(RUN_DIR.exec(name)?.[1] ?? '0', 10),
		collected: existsSync(join(runDir, 'project')),
		error: typeof result?.error === 'string' ? result.error : null,
	};
}

/**
 * Every run directory an eval directory holds, in run order. A directory that
 * does not exist holds nothing — results are read from trees that may have been
 * pruned or never downloaded.
 */
export function readRunOutcomes(evalDir: string): RunOutcome[] {
	if (!existsSync(evalDir)) {
		return [];
	}
	return readdirSync(evalDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && RUN_DIR.test(entry.name))
		.map((entry) => readRunOutcome(join(evalDir, entry.name)))
		.sort((a, b) => a.run - b.run);
}

/** How many runs of an eval directory produced something to measure. */
export function countCollectedRuns(evalDir: string): number {
	return readRunOutcomes(evalDir).filter((outcome) => outcome.collected).length;
}

/** Removes a directory if nothing is left in it, and says whether it did. */
function removeIfEmpty(dir: string): boolean {
	if (!existsSync(dir) || readdirSync(dir).length > 0) {
		return false;
	}
	rmSync(dir, { recursive: true });
	return true;
}

/**
 * Deletes run directories, and then the directories they leave behind.
 *
 * An eval directory whose last run this removed goes with it, summary.json
 * included: that file describes runs nobody can read any more, and leaving it
 * would leave a sample claiming a size it no longer has. Result and experiment
 * directories left empty follow, up to but never including `stopAt` — normally
 * results/ itself.
 *
 * `directories` counts those, not the runs.
 */
export function deleteRunDirs(
	runDirs: readonly string[],
	stopAt: string,
): { runs: number; directories: number } {
	let runs = 0;
	let directories = 0;

	const evalDirs = new Set<string>();
	for (const runDir of runDirs) {
		rmSync(runDir, { recursive: true, force: true });
		evalDirs.add(dirname(runDir));
		runs += 1;
	}

	for (const evalDir of evalDirs) {
		let dir = evalDir;
		if (readRunOutcomes(evalDir).length === 0 && existsSync(evalDir)) {
			rmSync(evalDir, { recursive: true });
			directories += 1;
		}
		while (dir !== stopAt && dir !== dirname(dir)) {
			dir = dirname(dir);
			if (dir === stopAt || !removeIfEmpty(dir)) {
				break;
			}
			directories += 1;
		}
	}

	return { runs, directories };
}

/** What stopped a run, coarsely — enough to decide what to do about it. */
export type RunErrorKind = 'billing' | 'timeout' | 'network' | 'other' | 'unrecorded';

const ERROR_KINDS: Array<{ kind: RunErrorKind; pattern: RegExp }> = [
	{ kind: 'billing', pattern: /\b402\b|credit balance|insufficient funds|quota/i },
	{ kind: 'timeout', pattern: /timed out|timeout/i },
	{ kind: 'network', pattern: /fetch failed|unreachable|ECONNREFUSED|ENOTFOUND|socket hang up/i },
];

/**
 * Sorts a recorded error into a kind. Billing before timeout, because an
 * unreachable gateway that answered 402 often reports both and the account is
 * the thing to fix.
 */
export function classifyRunError(error: string | null): RunErrorKind {
	if (error === null) {
		return 'unrecorded';
	}
	return ERROR_KINDS.find(({ pattern }) => pattern.test(error))?.kind ?? 'other';
}
