// Post-run analysis for the agentic-reference reuse-component eval.
//
// Loaded by scripts/analyze-results.mjs, which knows only this module's
// exported shape. Everything specific to this eval — which repository it
// measures against, which metrics matter — lives here and under __analysis__/.
//
// This file and __analysis__/ are excluded from sandbox uploads via
// IGNORED_PATTERNS in patches/@vercel__agent-eval@1.2.0.patch. Without that,
// the agent under evaluation could read the definitions of the metrics scoring
// it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { baselineKey, complexityForFiles, loadOrBuildBaseline } from './__analysis__/baseline.ts';
import { computeChurn } from './__analysis__/churn.ts';
import type { ExternalRepoPin } from './__analysis__/external-ref.ts';
import { prepareRef, validPin } from './__analysis__/external-ref.ts';
import { SCRIPT_EXTENSIONS } from './__analysis__/paths.ts';
import { readCost, readSpeed } from './__analysis__/run-signals.ts';
import { classifyToolUse } from './__analysis__/tool-taxonomy.ts';
import { diffTrees } from './__analysis__/tree-diff.ts';

export interface PostAnalysisContext {
	runDir: string;
	projectDir: string;
	fixtureDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
	/** Parsed result.json. */
	result: unknown;
	/** Parsed transcript.json. Throws when absent; callers must handle it. */
	readTranscript: () => unknown;
	/**
	 * Resolve the pinned ref to a local directory. Injectable so tests can supply
	 * a fixture tree instead of downloading 20MB from GitHub; the gateway leaves
	 * it unset and gets the real cache.
	 */
	resolveRefDir?: (pin: ExternalRepoPin) => string;
	/**
	 * Where committed complexity baselines live. Injectable alongside
	 * resolveRefDir: a test that supplies its own ref tree must also get a
	 * baseline built from that tree, or `before` would be read from the real
	 * repository's baseline and the delta would be nonsense.
	 */
	baselineDir?: string;
}

const REF_CACHE_DIR = new URL('../../.eval-cache/refs', import.meta.url).pathname;
const BASELINE_DIR = new URL('./__analysis__/baselines', import.meta.url).pathname;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pinOf(result: unknown): ExternalRepoPin | null {
	const record = isRecord(result) ? result : {};
	const analysis = isRecord(record.analysis) ? record.analysis : {};
	return validPin(analysis.externalRepo);
}

function transcriptEvents(readTranscript: () => unknown): unknown[] | null {
	try {
		const transcript = readTranscript();
		return isRecord(transcript) && Array.isArray(transcript.events) ? transcript.events : null;
	} catch {
		// An interrupted run can leave no transcript. Tree metrics still work.
		return null;
	}
}

export async function analyzeRun(
	context: PostAnalysisContext,
): Promise<Record<string, unknown> | null> {
	const pin = pinOf(context.result);
	// A run that recorded no pin cannot be measured against anything; the
	// fixture's current pin may have moved since, which would silently change
	// every historical delta.
	if (pin === null) return null;

	const resolveRefDir =
		context.resolveRefDir ?? ((target) => prepareRef(REF_CACHE_DIR, target.repo, target.ref));
	const refDir = resolveRefDir(pin);
	const diff = diffTrees(refDir, context.projectDir);

	// Complexity needs an AST, so .css participates in SLoC but not here.
	const changedScripts = diff.files.filter((file) => SCRIPT_EXTENSIONS.test(file));
	const baseline = loadOrBuildBaseline(context.baselineDir ?? BASELINE_DIR, refDir, pin);

	// A file the agent created has no baseline entry and contributes 0 before.
	const before = changedScripts.reduce(
		(totals, file) => {
			const entry = baseline.files[file];
			return {
				cyclomatic: totals.cyclomatic + (entry?.cyclomatic ?? 0),
				cognitive: totals.cognitive + (entry?.cognitive ?? 0),
			};
		},
		{ cyclomatic: 0, cognitive: 0 },
	);
	const after = complexityForFiles(context.projectDir, changedScripts);

	const cognitiveDelta = after.cognitive - before.cognitive;
	const events = transcriptEvents(context.readTranscript);

	const record = {
		experiment: context.experiment,
		eval: context.evalName,
		run: context.run,
		model: context.model,
		timestamp: context.timestamp,
		fixtureRef: `${pin.repo}@${pin.ref.slice(0, 12)}`,
		status: isRecord(context.result) ? (context.result.status ?? null) : null,

		speed: readSpeed(context.result),
		cost: readCost(context.result),

		toolUse: events === null ? null : classifyToolUse(events),
		churn: events === null ? null : computeChurn(events),

		diff,

		complexity: {
			cyclomatic: {
				before: before.cyclomatic,
				after: after.cyclomatic,
				delta: after.cyclomatic - before.cyclomatic,
			},
			cognitive: {
				before: before.cognitive,
				after: after.cognitive,
				delta: cognitiveDelta,
			},
			// Complexity correlates ~0.9 with lines of code, so a bare delta partly
			// re-measures verbosity. null rather than Infinity when nothing changed:
			// a stored Infinity would poison every later mean.
			densityPerSloc: diff.sloc.net === 0 ? null : cognitiveDelta / diff.sloc.net,
			parseFailures: after.parseFailures,
			baselineKey: baselineKey(pin),
		},
	};

	writeFileSync(join(context.runDir, 'analysis.json'), JSON.stringify(record, null, 2) + '\n');
	return record;
}

function mean(values: number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number | null, digits = 2): number | null {
	return value === null ? null : Number(value.toFixed(digits));
}

function numbersAt(
	rows: Array<Record<string, unknown>>,
	read: (row: Record<string, unknown>) => unknown,
): number[] {
	return rows.flatMap((row) => {
		const value = read(row);
		return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
	});
}

export function summarize(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const groups = new Map<string, Array<Record<string, unknown>>>();
	for (const row of rows) {
		const key = `${String(row.experiment)}::${String(row.eval)}`;
		const existing = groups.get(key);
		if (existing) existing.push(row);
		else groups.set(key, [row]);
	}

	return [...groups.values()].map((group) => {
		const costs = numbersAt(
			group,
			(row) => (row.cost as { estimatedCostUsd?: number } | null)?.estimatedCostUsd,
		);
		const durations = numbersAt(
			group,
			(row) => (row.speed as { durationSeconds?: number } | null)?.durationSeconds,
		);
		const docs = numbersAt(
			group,
			(row) => (row.toolUse as { buckets?: { docs?: number } } | null)?.buckets?.docs,
		);
		const exploration = numbersAt(
			group,
			(row) => (row.toolUse as { buckets?: { exploration?: number } } | null)?.buckets?.exploration,
		);
		const slocAdded = numbersAt(
			group,
			(row) => (row.diff as { sloc?: { added?: number } } | null)?.sloc?.added,
		);
		const cognitiveDelta = numbersAt(
			group,
			(row) => (row.complexity as { cognitive?: { delta?: number } } | null)?.cognitive?.delta,
		);

		// An aggregate silently spanning two pins is not one measurement.
		const fixtureRefs = [...new Set(group.map((row) => String(row.fixtureRef)))];

		return {
			experiment: group[0]?.experiment,
			eval: group[0]?.eval,
			fixtureRefs,
			runs: group.length,
			passed: group.filter((row) => row.status === 'passed').length,
			// null rather than 0 when nothing priced, so an unpriced model does not
			// read as a free one.
			costUsd: {
				total: costs.length === 0 ? null : round(costs.reduce((sum, cost) => sum + cost, 0)),
				reported: costs.length,
			},
			durationSeconds: { mean: round(mean(durations)) },
			docCalls: { mean: round(mean(docs)) },
			explorationCalls: { mean: round(mean(exploration)) },
			slocAdded: { mean: round(mean(slocAdded)) },
			cognitiveDelta: { mean: round(mean(cognitiveDelta)) },
		};
	});
}

export function renderTables(
	rows: Array<Record<string, unknown>>,
	summary: Array<Record<string, unknown>>,
): void {
	console.table(
		rows.map((row) => ({
			experiment: String(row.experiment).replace(/^agentic-ref-/, ''),
			run: row.run,
			status: row.status,
			seconds: (row.speed as { durationSeconds?: number } | null)?.durationSeconds ?? null,
			turns: (row.speed as { turns?: number } | null)?.turns ?? null,
			costUsd: (row.cost as { estimatedCostUsd?: number } | null)?.estimatedCostUsd ?? null,
			docs: (row.toolUse as { buckets?: { docs?: number } } | null)?.buckets?.docs ?? null,
			explore:
				(row.toolUse as { buckets?: { exploration?: number } } | null)?.buckets?.exploration ??
				null,
			slocAdded: (row.diff as { sloc?: { added?: number } } | null)?.sloc?.added ?? null,
			cognitive:
				(row.complexity as { cognitive?: { delta?: number } } | null)?.cognitive?.delta ?? null,
		})),
	);

	console.table(
		summary.map((group) => ({
			experiment: String(group.experiment).replace(/^agentic-ref-/, ''),
			fixtureRef:
				(group.fixtureRefs as string[]).length === 1
					? (group.fixtureRefs as string[])[0]
					: `mixed (${(group.fixtureRefs as string[]).length})`,
			runs: group.runs,
			passed: group.passed,
			costUsd: (group.costUsd as { total: number | null }).total,
			secondsMean: (group.durationSeconds as { mean: number | null }).mean,
			docsMean: (group.docCalls as { mean: number | null }).mean,
			exploreMean: (group.explorationCalls as { mean: number | null }).mean,
			slocMean: (group.slocAdded as { mean: number | null }).mean,
			cognitiveMean: (group.cognitiveDelta as { mean: number | null }).mean,
		})),
	);
}
