/**
 * Conventions for where review-changes eval artefacts live on disk.
 *
 * All paths are relative to the `eval/` root (i.e. `process.cwd()` when
 * these CLIs are invoked through their pnpm scripts). Scenario dirs are
 * git-tracked; `.runs/` inside each is gitignored.
 */
import path from 'node:path';
import fs from 'node:fs/promises';

export const REVIEW_TASKS_DIR = 'review-changes/tasks';

export function scenarioDir(scenarioId: string): string {
	return path.join(REVIEW_TASKS_DIR, scenarioId);
}

export function fixturePath(scenarioId: string): string {
	return path.join(scenarioDir(scenarioId), 'fixture.json');
}

export function runsDir(scenarioId: string): string {
	return path.join(scenarioDir(scenarioId), '.runs');
}

/**
 * Filesystem-safe timestamp with milliseconds: `2026-05-20T14-20-04.317`.
 * Millisecond precision keeps two runs that finish in the same second
 * from colliding on the same run-record filename.
 */
export function timestampSlug(date = new Date()): string {
	return date.toISOString().replace('Z', '').replace(/:/g, '-');
}

/**
 * `2026-05-20T14-20-04--claude-sonnet-4.6.json`
 */
export function runRecordFilename(ts: string, modelOrBaseline: string): string {
	const safe = modelOrBaseline.replace(/[^a-zA-Z0-9._-]/g, '_');
	return `${ts}--${safe}.json`;
}

export function payloadFilename(ts: string, modelOrBaseline: string): string {
	const safe = modelOrBaseline.replace(/[^a-zA-Z0-9._-]/g, '_');
	return `${ts}--${safe}.payload.json`;
}

export async function ensureDir(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
}

export async function listScenarios(root = REVIEW_TASKS_DIR): Promise<string[]> {
	try {
		const entries = await fs.readdir(root, { withFileTypes: true });
		const candidates = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			// Skip hidden / underscore-prefixed dirs (e.g. _fixtures-cache).
			.filter((name) => !name.startsWith('.') && !name.startsWith('_'));
		// Only directories that actually contain a fixture.json are scenarios.
		const out: string[] = [];
		for (const name of candidates) {
			try {
				await fs.access(path.join(root, name, 'fixture.json'));
				out.push(name);
			} catch {
				// not a real scenario dir
			}
		}
		return out.sort();
	} catch {
		return [];
	}
}
