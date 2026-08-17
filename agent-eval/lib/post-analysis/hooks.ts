// Reading an experiment's post-analysis module off its definition.
//
// Two halves. postAnalysisFrom is the part that can be wrong: deciding whether
// an experiment carries a post-analysis module, and whether that module
// implements the contract. TypeScript checks this at the definition site; this
// is the runtime backstop for a dynamically imported module.
//
// createPostAnalysisLoader is the IO around it — finding <experiment>.ts and
// importing it. It used to live in scripts/analyze-results.ts, which was fine
// while that was the only script resolving a module. judge-ds-misuse.ts is the
// second, and it hardcoded one module for every run it found: it had no
// equivalent of the "names no module, not ours to measure" skip, so it spent a
// paid model call on runs the analyzer deliberately declines to touch, and read
// its sidecars at a metricsVersion that was only ever right by coincidence.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { messageOf } from '../utils/error.ts';
import { isRecord } from '../utils/type.ts';

import type { PostAnalysis } from './types.ts';

/**
 * The `postAnalysis` an experiment module carries, or null when it carries none
 * — which just means "not ours to measure".
 *
 * Anything present but malformed throws instead: an experiment that meant to be
 * analysed and is silently skipped is the failure mode worth being loud about.
 */
export function postAnalysisFrom(
	experimentModule: unknown,
	experiment: string,
): PostAnalysis | null {
	const config = isRecord(experimentModule) ? experimentModule.default : undefined;
	const postAnalysis = isRecord(config) ? config.postAnalysis : undefined;
	if (postAnalysis === undefined || postAnalysis === null) return null;

	const where = `experiments/${experiment}.ts: postAnalysis`;
	if (!isRecord(postAnalysis)) {
		throw new Error(`${where} must be an object, got ${typeof postAnalysis}`);
	}
	if (typeof postAnalysis.analyzeRun !== 'function') {
		throw new Error(`${where} must provide an analyzeRun function`);
	}
	if (typeof postAnalysis.summarize !== 'function') {
		throw new Error(`${where} must provide a summarize function`);
	}
	// Optional, but a typo'd key would otherwise silently drop every delta.
	if (
		postAnalysis.deltaToBaseline !== undefined &&
		typeof postAnalysis.deltaToBaseline !== 'function'
	) {
		throw new Error(`${where} carries a deltaToBaseline that is not a function`);
	}
	// Optional, but a malformed one would never match a committed baseline and
	// would quietly re-measure the pinned tree on every invocation.
	if (
		postAnalysis.metricsVersion !== undefined &&
		typeof postAnalysis.metricsVersion !== 'number'
	) {
		throw new Error(`${where} carries a metricsVersion that is not a number`);
	}
	return postAnalysis as unknown as PostAnalysis;
}

/**
 * A resolver for "which module analyses this experiment's runs", memoized per
 * loader.
 *
 * The module comes across as a live object, so arms that share one share it by
 * reference — which is exactly what groups their runs into a single summary.
 * Memoizing preserves that, and keeps one arm's ten runs to a single import.
 *
 * `experimentDirs` is caller-supplied and searched in order: agentic-reference
 * arms are generated into .agentic-ref/experiments/ rather than experiments/,
 * and which roots exist is the script's business, not this module's.
 */
export function createPostAnalysisLoader(experimentDirs: readonly string[]) {
	const byExperiment = new Map<string, PostAnalysis | null>();

	return async function loadPostAnalysis(
		experiment: string,
		failures: string[],
	): Promise<PostAnalysis | null> {
		const cached = byExperiment.get(experiment);
		if (cached !== undefined) return cached;

		const definition = experimentDirs.map((dir) => join(dir, `${experiment}.ts`)).find(existsSync);
		// Results outlive experiment definitions: a renamed or deleted arm leaves
		// its runs on disk, and those are skipped rather than fatal.
		let postAnalysis: PostAnalysis | null = null;
		if (definition) {
			try {
				postAnalysis = postAnalysisFrom(await import(pathToFileURL(definition).href), experiment);
			} catch (error) {
				// A definition that will not import, or names a malformed module, must
				// not cost every other arm its analysis. Reported once: the outcome is
				// cached below, so the remaining runs of this arm skip quietly.
				failures.push(`experiments/${experiment}.ts: ${messageOf(error)}`);
			}
		}

		byExperiment.set(experiment, postAnalysis);
		return postAnalysis;
	};
}
