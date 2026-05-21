/**
 * Re-derive `<ts>--<model>.payload.json` from each `<ts>--<model>.json`
 * run record.
 *
 * The two files are deliberately split so a Storybook addon's stories can
 * `import payload from './fixture.json'` without parsing surrounding
 * metadata. If the run-record schema evolves, this helper keeps the
 * `.payload.json` files in sync without re-running the agent.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import {
	REVIEW_TASKS_DIR,
	listScenarios,
	runsDir,
} from './paths.ts';
import { RunRecordSchema, ReviewStateSchema, type ReviewState } from './schema.ts';

export interface ExtractResult {
	scenarioId: string;
	written: string[];
	skipped: { file: string; reason: string }[];
}

function payloadCounterpart(runRecordFile: string): string {
	return runRecordFile.replace(/\.json$/, '.payload.json');
}

export async function extractPayloadsForScenario(
	scenarioId: string,
	root = REVIEW_TASKS_DIR,
): Promise<ExtractResult> {
	const dir = path.join(root, scenarioId, '.runs');
	const written: string[] = [];
	const skipped: { file: string; reason: string }[] = [];
	let entries: string[] = [];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return { scenarioId, written, skipped };
	}

	for (const entry of entries) {
		if (!entry.endsWith('.json') || entry.endsWith('.payload.json')) continue;
		const full = path.join(dir, entry);
		let parsed: unknown;
		try {
			parsed = JSON.parse(await fs.readFile(full, 'utf-8'));
		} catch (error) {
			skipped.push({ file: entry, reason: `unreadable JSON: ${(error as Error).message}` });
			continue;
		}
		const recordResult = v.safeParse(RunRecordSchema, parsed);
		if (!recordResult.success) {
			skipped.push({ file: entry, reason: 'not a run record' });
			continue;
		}
		const pushed = recordResult.output.pushedReviewState;
		if (!pushed) {
			skipped.push({ file: entry, reason: 'no pushedReviewState' });
			continue;
		}
		// Validate the payload one more time against the canonical schema
		// before we write it out — the .payload.json files are the contract.
		const payloadResult = v.safeParse(ReviewStateSchema, pushed);
		if (!payloadResult.success) {
			skipped.push({ file: entry, reason: 'invalid ReviewState' });
			continue;
		}
		const out = path.join(dir, payloadCounterpart(entry));
		const payload: ReviewState = payloadResult.output;
		await fs.writeFile(out, JSON.stringify(payload, null, 2));
		written.push(path.basename(out));
	}

	return { scenarioId, written, skipped };
}

export async function extractAllPayloads(root = REVIEW_TASKS_DIR): Promise<ExtractResult[]> {
	const scenarios = await listScenarios(root);
	const results: ExtractResult[] = [];
	for (const scenarioId of scenarios) {
		results.push(await extractPayloadsForScenario(scenarioId, root));
	}
	return results;
}

/**
 * Convenience for tests / one-off scripts: write the run record AND the
 * payload counterpart in one call. Used by the runner so a fresh run is
 * never half-written.
 */
export async function writeRunRecordWithPayload(
	dir: string,
	runRecordFilename: string,
	record: unknown,
): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
	const fullRecord = path.join(dir, runRecordFilename);
	await fs.writeFile(fullRecord, JSON.stringify(record, null, 2));
	const payloadName = payloadCounterpart(runRecordFilename);
	const pushed = (record as { pushedReviewState?: unknown }).pushedReviewState;
	if (pushed) {
		const validated = v.safeParse(ReviewStateSchema, pushed);
		if (validated.success) {
			await fs.writeFile(
				path.join(dir, payloadName),
				JSON.stringify(validated.output, null, 2),
			);
		}
	}
}

export async function loadRunRecord(file: string): Promise<unknown> {
	return JSON.parse(await fs.readFile(file, 'utf-8'));
}

export { runsDir };
