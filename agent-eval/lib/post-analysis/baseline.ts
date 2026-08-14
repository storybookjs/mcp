// Measure the pristine tree a pin's runs are compared against, once per pin.
//
// The "before" side of any delta only changes when the pin moves, so measuring
// it per run is wasted work — for a complexity metric that means re-parsing a
// few hundred files for every repetition of every experiment. Keying by
// repo@sha means a moved pin misses the cache rather than silently reusing
// numbers from a different tree.
//
// The pin is the whole key. What a pinned tree is made of does not depend on
// which eval is about to run against it, so keying on eval-plus-pin only bought
// one byte-identical file per eval sharing a pin.
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
//
// One key is not opaque. A `nodeList` is split off into baselines/ds-nodes/ and
// never lands in the committed baseline, because that file is meant to stay
// readable in a diff and a whole-tree node census is thousands of records. The
// two are written together and only together: a baseline that hits the cache
// does not re-measure the tree, so its sidecar is whatever was committed beside
// it, and `--recompute` is what rebuilds the pair.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { pinSlug, prepareRef, type ExternalRepoPin } from '../agentic-reference/external-repo.ts';
import { readJson } from '../utils/files.ts';

import type { NodeRecord } from '../agentic-reference/metrics/ds-coverage/types.ts';
import type { Analysis, PostAnalysis } from './types.ts';

const DEFAULT_BASELINES_DIR = new URL('../../baselines', import.meta.url).pathname;
const DEFAULT_REF_CACHE_DIR = new URL('../../.eval-cache/refs', import.meta.url).pathname;

/** What a committed baseline file holds. `analysis` is opaque to this module. */
interface CommittedBaseline {
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
export function baselinePath(baselinesDir: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, `${pinSlug(pin)}.json`);
}

/** Where the whole-tree node census for a pin lives. */
const NODE_SIDECAR_DIR = 'ds-nodes';

interface CommittedNodeSidecar {
	repo: string;
	ref: string;
	metricsVersion?: number;
	nodes: NodeRecord[];
}

export function nodeSidecarPath(baselinesDir: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, NODE_SIDECAR_DIR, `${pinSlug(pin)}.json`);
}

export function writeNodeSidecar(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
	nodes: NodeRecord[],
): void {
	const path = nodeSidecarPath(baselinesDir, pin);
	mkdirSync(dirname(path), { recursive: true });
	const payload: CommittedNodeSidecar = { repo: pin.repo, ref: pin.ref, metricsVersion, nodes };
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');
}

/**
 * The pin's node census, or null when absent or measured under other rules.
 * A sidecar from another metricsVersion is worse than none: its records look
 * healthy and were built by a different path format.
 */
export function readNodeSidecar(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
): NodeRecord[] | null {
	const stored = readJson<CommittedNodeSidecar>(nodeSidecarPath(baselinesDir, pin));
	if (!stored || !Array.isArray(stored.nodes) || stored.metricsVersion !== metricsVersion) {
		return null;
	}
	return stored.nodes;
}

// Keyed by the resolved file path rather than the pin, so a caller pointed at
// a different baselinesDir gets its own entry.
const memo = new Map<string, BaselineAnalysis>();

// Paths already re-measured by this process. `--recompute` must rebuild a
// baseline once, not once per run: without this, every run of a ten-run eval
// re-measures the whole pinned tree, and the recompute pass crawls.
const recomputedPaths = new Set<string>();

export async function loadOrBuildBaselineAnalysis(
	options: BaselineOptions,
): Promise<BaselineAnalysis> {
	const { pin, postAnalysis, recompute = false } = options;
	const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
	const path = baselinePath(baselinesDir, pin);

	const remembered = memo.get(path);
	if (remembered && (!recompute || recomputedPaths.has(path))) return remembered;

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

	// Say why the tree is being measured: on a large tree a silent rebuild
	// reads as a hang, and "did --recompute touch the baselines?" should be
	// answerable from the output alone.
	const reason = recompute
		? 'recompute'
		: committed?.analysis
			? `metricsVersion ${committed.metricsVersion ?? 'none'} -> ${postAnalysis.metricsVersion ?? 'none'}`
			: 'no committed baseline';
	console.log(`Measuring baseline for ${pin.repo}@${pin.ref} (${reason})`);

	const analysis = await postAnalysis.analyzeRun({ mode: 'baseline', projectDir: dir, pin });
	if (analysis === null) {
		throw new Error(
			`analyzeRun returned no baseline for ${pin.repo}@${pin.ref}; ` +
				'a postAnalysis providing deltaToBaseline must measure its pinned tree.',
		);
	}

	// The node list rides out to its own file: the committed baseline is meant to
	// stay readable in a diff, and thousands of records would end that.
	const { nodeList, ...analysisWithoutNodes } = analysis as Analysis & {
		nodeList?: NodeRecord[];
	};
	if (nodeList !== undefined) {
		writeNodeSidecar(baselinesDir, pin, postAnalysis.metricsVersion, nodeList);
	}

	mkdirSync(dirname(path), { recursive: true });
	// JSON.stringify drops an undefined metricsVersion, keeping legacy modules'
	// files byte-identical to what they wrote before the field existed.
	const payload: CommittedBaseline = {
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion: postAnalysis.metricsVersion,
		analysis: analysisWithoutNodes,
	};
	// Tab-indented because the file is committed, and `pnpm format:check` would
	// otherwise fail on it the moment --recompute regenerates it. The match is
	// close but not exact — JSON.stringify always expands an array the formatter
	// would keep on one line — so run `pnpm format` after a rebuild.
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');

	const built = { dir, analysis: analysisWithoutNodes };
	memo.set(path, built);
	if (recompute) recomputedPaths.add(path);
	return built;
}
