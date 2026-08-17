// Measure the pristine tree a pin's runs are compared against, once per pin.
//
// The "before" side of any delta only changes when the pin moves, so measuring
// it per run is wasted work for both deterministic and LLM-based metrics.
//
// Pins are references on a repo. This lets us make non-breaking changes to pinned
// repos and moving the ref to their new branch head if needed.
//
// Pinned baselines are shared for *all* agentic reference evals. If you need to
// pin different metrics based on the eval or MCP being used in an experiment,
// you will need to make pins more specific again, at the expense of cache reuse.
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
	/**
	 * Whether a ds-coverage node list was written beside this file — the census
	 * `--nodes` produces, which the ds-misuse judge reads as its baseline half.
	 *
	 * Recorded rather than inferred because the two legitimate reasons for a
	 * missing list have to be told apart: a module that measures no nodes (or a
	 * pin declaring no design system) never writes one and must still hit the
	 * cache, while a baseline that had one and lost it has to be rebuilt. See
	 * isDsCoverageNodeListIntact for how an absent flag is read.
	 */
	hasDsCoverageNodeList?: boolean;
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

// Where the whole-tree ds-coverage node census for a pin lives. Named for the
// metric rather than for being a sidecar: it is one specific artifact, not
// generic post-analysis state, and the next reader should not have to open the
// file to learn which measurement put it there.
const DS_COVERAGE_NODE_LIST_DIR = 'ds-nodes';

interface CommittedDsCoverageNodeList {
	repo: string;
	ref: string;
	metricsVersion?: number;
	nodes: NodeRecord[];
}

/**
 * The node list for a pin, under its own directory so `ls baselines/` still
 * shows one file per pin. Same slug as the baseline, so the pair is obvious on
 * disk.
 */
export function dsCoverageNodeListPath(baselinesDir: string, pin: ExternalRepoPin): string {
	return join(baselinesDir, DS_COVERAGE_NODE_LIST_DIR, `${pinSlug(pin)}.json`);
}

/** Commit a pin's node census, overwriting any list already there. */
export function writeDsCoverageNodeList(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
	nodes: NodeRecord[],
): void {
	const path = dsCoverageNodeListPath(baselinesDir, pin);
	mkdirSync(dirname(path), { recursive: true });
	const payload: CommittedDsCoverageNodeList = {
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion,
		nodes,
	};
	// Tab-indented for the same reason the baseline is, and needing `pnpm format`
	// afterwards for the same reason too — more urgently here: JSON.stringify puts
	// every array element on its own line, oxfmt collapses short ones, and every
	// NodeRecord carries a `props` array. Committing a generated node list without
	// formatting it first fails `format:check` on essentially every record.
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');
}

/**
 * The pin's node census, or null when absent or measured under other rules.
 * A list from another metricsVersion is worse than none: its records look
 * healthy and were built by a different path format.
 */
export function readDsCoverageNodeList(
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
): NodeRecord[] | null {
	const stored = readJson<CommittedDsCoverageNodeList>(dsCoverageNodeListPath(baselinesDir, pin));
	if (!stored || !Array.isArray(stored.nodes) || stored.metricsVersion !== metricsVersion) {
		return null;
	}
	// The file says which pin it was measured from, and it is checked rather than
	// trusted. The filename is a slug, so it is lossy by construction, and a file
	// that was hand-moved, copied between branches, or landed on by two pins
	// slugging alike would otherwise hand the judge another tree's census under
	// this pin's name — scoring a run against markup it never saw. Failing closed
	// costs a re-measure; failing open costs a wrong number nobody can see is wrong.
	if (stored.repo !== pin.repo || stored.ref !== pin.ref) {
		return null;
	}
	return stored.nodes;
}

// Keyed by the resolved file path rather than the pin, so a caller pointed at
// a different baselinesDir gets its own entry — and by metricsVersion too, since
// postAnalysis is resolved per experiment while the path is not. Two experiments
// on one pin whose modules disagree on the version must not read each other's
// numbers: without the version in the key the second one takes a memo hit and
// never reaches the comparison below that exists to stop exactly that.
const memo = new Map<string, BaselineAnalysis>();

// Baselines already re-measured by this process, same key. `--recompute` must
// rebuild a baseline once, not once per run: without this, every run of a
// ten-run eval re-measures the whole pinned tree, and the recompute pass crawls.
const recomputedKeys = new Set<string>();

/** The memo identity of a baseline: which file, measured under which rules. */
function memoKeyFor(path: string, metricsVersion: number | undefined): string {
	return `${path}#${metricsVersion ?? 'none'}`;
}

/**
 * Whether a committed baseline's node-list state is one this module can stand
 * behind — that is, whether the file and the disk beside it still agree.
 *
 * The interesting case is silence. An absent flag means two different things,
 * and reading them the same way is what let this repo ship three baselines at
 * the current metricsVersion with no node list and no way to ever grow one:
 *
 * - On a file declaring no metricsVersion either, it means "predates the
 *   field", which is the same thing as "never had one". Rebuilding every legacy
 *   baseline to learn that is not worth what it costs.
 * - On a file that *does* declare a version, it means the file was written
 *   before the field existed and then version-bumped in place rather than
 *   regenerated. Read permissively that is a permanent cache hit, so the node
 *   list it should have written never gets written, `judge:ds-misuse` skips
 *   every run for want of a census, and the fix it prints — a plain
 *   `results:analyze` — silently does nothing. Read as a miss it costs one
 *   rebuild, after which the file records its state explicitly and says so.
 */
function isDsCoverageNodeListIntact(
	committed: CommittedBaseline | null,
	baselinesDir: string,
	pin: ExternalRepoPin,
	metricsVersion: number | undefined,
): boolean {
	if (committed?.hasDsCoverageNodeList === undefined)
		return committed?.metricsVersion === undefined;
	if (!committed.hasDsCoverageNodeList) return true;
	return readDsCoverageNodeList(baselinesDir, pin, metricsVersion) !== null;
}

export async function loadOrBuildBaselineAnalysis(
	options: BaselineOptions,
): Promise<BaselineAnalysis> {
	const { pin, postAnalysis, recompute = false } = options;
	const baselinesDir = options.baselinesDir ?? DEFAULT_BASELINES_DIR;
	const path = baselinePath(baselinesDir, pin);
	const memoKey = memoKeyFor(path, postAnalysis.metricsVersion);

	// Anything in the memo already passed the checks below, so a hit cannot
	// smuggle a stale version or a half-committed pair past them.
	const remembered = memo.get(memoKey);
	if (remembered && (!recompute || recomputedKeys.has(memoKey))) return remembered;

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
	const versionMatches =
		committed?.analysis !== undefined && committed.metricsVersion === postAnalysis.metricsVersion;
	// A baseline that recorded a node list and no longer has one beside it is a
	// cache miss too. Nothing else would ever write the missing half: the pair is
	// only produced by a rebuild, and a current-looking baseline suppresses one
	// forever. Rebuilding is what makes "written together and only together" true
	// of the files on disk rather than just of this function.
	const nodeListIntact = isDsCoverageNodeListIntact(
		committed,
		baselinesDir,
		pin,
		postAnalysis.metricsVersion,
	);
	if (versionMatches && nodeListIntact) {
		const loaded = { dir, analysis: committed.analysis };
		memo.set(memoKey, loaded);
		return loaded;
	}

	// Say why the tree is being measured: on a large tree a silent rebuild
	// reads as a hang, and "did --recompute touch the baselines?" should be
	// answerable from the output alone.
	const reason = recompute
		? 'recompute'
		: !committed?.analysis
			? 'no committed baseline'
			: versionMatches
				? committed.hasDsCoverageNodeList === undefined
					? 'baseline records no ds-coverage node list state'
					: 'ds-coverage node list missing'
				: `metricsVersion ${committed.metricsVersion ?? 'none'} -> ${postAnalysis.metricsVersion ?? 'none'}`;
	console.log(`Measuring baseline for ${pin.repo}@${pin.ref} (${reason})`);

	const analysis = await postAnalysis.analyzeRun({ mode: 'baseline', projectDir: dir, pin });
	if (analysis === null) {
		throw new Error(
			`analyzeRun returned no baseline for ${pin.repo}@${pin.ref}; ` +
				'a postAnalysis providing deltaToBaseline must measure its pinned tree.',
		);
	}

	// The node list rides out to its own file: the committed baseline is meant to
	// stay readable in a diff, and thousands of records would end that. Guarded
	// with Array.isArray rather than a presence check, because this is the one
	// place the module looks inside an analysis it otherwise treats as opaque —
	// the same guard readDsCoverageNodeList applies at the other end.
	const { nodeList, ...analysisWithoutNodes } = analysis as Analysis & {
		nodeList?: unknown;
	};
	const hasDsCoverageNodeList = Array.isArray(nodeList);
	if (hasDsCoverageNodeList) {
		writeDsCoverageNodeList(
			baselinesDir,
			pin,
			postAnalysis.metricsVersion,
			nodeList as NodeRecord[],
		);
	}

	mkdirSync(dirname(path), { recursive: true });
	// JSON.stringify drops an undefined metricsVersion, keeping legacy modules'
	// files byte-identical to what they wrote before the field existed.
	const payload: CommittedBaseline = {
		repo: pin.repo,
		ref: pin.ref,
		metricsVersion: postAnalysis.metricsVersion,
		hasDsCoverageNodeList,
		analysis: analysisWithoutNodes,
	};
	// Tab-indented because the file is committed, and `pnpm format:check` would
	// otherwise fail on it the moment --recompute regenerates it. The match is
	// close but not exact — JSON.stringify always expands an array the formatter
	// would keep on one line — so run `pnpm format` after a rebuild.
	writeFileSync(path, JSON.stringify(payload, null, '\t') + '\n');

	const built = { dir, analysis: analysisWithoutNodes };
	memo.set(memoKey, built);
	if (recompute) recomputedKeys.add(memoKey);
	return built;
}
