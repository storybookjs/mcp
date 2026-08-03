// Measure the pristine tree an eval's runs are compared against, once per pin.
//
// The "before" side of any delta only changes when the pin moves, so measuring
// it per run is wasted work — for a complexity metric that means re-parsing a
// few hundred files for every repetition of every experiment. Keying by
// repo@sha means a moved pin misses the cache rather than silently reusing
// numbers from a different tree.
//
// Baselines are committed rather than left in the gitignored .eval-cache/, so
// CI never recomputes one and a reviewer sees the numbers change when a pin
// moves. `--recompute` rebuilds them, which is the only time the analyzer needs
// to measure the upstream tree at all.
//
// What a baseline *contains* is the eval's business: this module calls the
// eval's own analyzeRun against the pinned tree and stores whatever comes back.
// An eval wanting a diff-friendly committed file should emit stable key order,
// as nothing here reorders its output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { pinSlug, prepareRef, type ExternalRepoPin } from '../agentic-reference/external-repo.ts';
import { readJson } from '../utils/files.ts';

import type { Analysis, PostAnalysis } from './types.ts';

const DEFAULT_BASELINES_DIR = new URL('../../baselines', import.meta.url).pathname;
const DEFAULT_REF_CACHE_DIR = new URL('../../.eval-cache/refs', import.meta.url).pathname;

/** What a committed baseline file holds. `analysis` is opaque to this module. */
interface CommittedBaseline {
	eval: string;
	repo: string;
	ref: string;
	/** The eval's metricsVersion at measuring time; absent for legacy files. */
	metricsVersion?: number;
	analysis: Analysis;
}

export interface BaselineAnalysis {
	/** Absolute path to the pin's materialized tree. */
	dir: string;
	/** What the eval's analyzeRun returned for that tree. */
	analysis: Analysis;
}

export interface BaselineOptions {
	evalName: string;
	fixtureDir: string;
	pin: ExternalRepoPin;
	postAnalysis: PostAnalysis;
	/** Re-measure the pinned tree and overwrite the committed baseline. */
	recompute?: boolean;
	/** Overridable for testing. */
	baselinesDir?: string;
	/** Overridable for testing. */
	refCacheDir?: string;
}

/**
 * Both halves of the pin have their separators escaped, so each stays a single
 * path segment: a ref like `heads/main` would otherwise turn the filename into
 * a nested path.
 */
export function baselinePath(baselinesDir: string, evalName: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, evalName, `${pinSlug(pin)}.json`);
}

// Keyed by the resolved file path rather than eval+pin, so a caller pointed at
// a different baselinesDir gets its own entry.
const memo = new Map<string, BaselineAnalysis>();

export async function loadOrBuildBaselineAnalysis(
	options: BaselineOptions,
): Promise<BaselineAnalysis> {
	const { evalName, fixtureDir, pin, postAnalysis, recompute = false } = options;
	const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
	const path = baselinePath(baselinesDir, evalName, pin);

	const remembered = memo.get(path);
	if (remembered && !recompute) return remembered;

	// The tree itself is materialized either way: a committed baseline saves the
	// measuring, not the download, and a delta metric comparing file contents
	// needs both sides on disk.
	const dir = prepareRef(options.refCacheDir ?? DEFAULT_REF_CACHE_DIR, pin.repo, pin.ref);

	// A truncated baseline is worse than none, and readJson nulls one out. One
	// measured under another metricsVersion is worse still — its numbers look
	// healthy and mean something else — so a version mismatch is a cache miss:
	// the tree is already materialized above, and the rebuild below overwrites
	// the stale file with numbers measured under the current definitions.
	const committed = recompute ? null : readJson<CommittedBaseline>(path);
	if (committed?.analysis && committed.metricsVersion === postAnalysis.metricsVersion) {
		const loaded = { dir, analysis: committed.analysis };
		memo.set(path, loaded);
		return loaded;
	}

	const analysis = await postAnalysis.analyzeRun({
		mode: 'baseline',
		projectDir: dir,
		fixtureDir,
		evalName,
		pin,
	});
	if (analysis === null) {
		throw new Error(
			`${evalName}: analyzeRun returned no baseline for ${pin.repo}@${pin.ref}; ` +
				'a postAnalysis providing deltaToBaseline must measure its pinned tree.',
		);
	}

	mkdirSync(dirname(path), { recursive: true });
	// JSON.stringify drops an undefined metricsVersion, keeping legacy modules'
	// files byte-identical to what they wrote before the field existed.
	const payload: CommittedBaseline = {
		eval: evalName,
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion: postAnalysis.metricsVersion,
		analysis,
	};
	// Tab-indented because the file is committed, and `pnpm format:check` would
	// otherwise fail on it the moment --recompute regenerates it.
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');

	const built = { dir, analysis };
	memo.set(path, built);
	return built;
}
